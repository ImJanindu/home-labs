# Lab 03: Nginx HTTPS with Certbot & DuckDNS

A hands-on implementation of automated **TLS/SSL encryption** for our containerized Next.js application using **Nginx**, **Certbot (Let's Encrypt)**, **DuckDNS**, and **Docker Compose** on an AWS EC2 instance.

This lab builds directly on the reverse proxy setup in [Lab 02: Nginx Reverse Proxy](../02-nginx-reverse-proxy/README.md) by introducing a custom domain, trusted TLS certificates, secure HTTPS on port 443, automatic HTTP-to-HTTPS redirection, and automated certificate renewals.

---

## 🎯 Overview & Lab Objectives

In [Lab 02](../02-nginx-reverse-proxy/README.md), Nginx accepted public HTTP traffic on port 80 and forwarded requests to the internal Next.js container on port 3000. While the site was accessible over standard web ports, client traffic was unencrypted (plain HTTP), leaving sensitive data vulnerable to eavesdropping and tampering.

In this lab, we upgrade the deployment to production-grade security:
1. **Dynamic DNS Mapping**: Register a free custom subdomain via **DuckDNS** and map it to our EC2 public IPv4 address.
2. **Automated TLS Issuance**: Provision a trusted, free TLS/SSL certificate from **Let's Encrypt** using the official **Certbot** container.
3. **The Two-Stage Bootstrap Architecture**: Resolve the classic bootstrap deadlock using an initial HTTP configuration to pass ACME HTTP-01 domain validation, then transitioning to the production HTTPS configuration.
4. **TLS Termination & Secure Reverse Proxy**: Terminate TLS at Nginx on port 443, pass decrypted requests over Docker's internal network to Next.js on port 3000, and redirect all legacy HTTP (port 80) traffic to HTTPS.
5. **Shared Docker Bind Mounts**: Securely share webroot validation tokens and certificates between Certbot and Nginx without baking credentials into images.
6. **Automated Lifecycle Management**: Implement and test certificate renewal with automated cron jobs and zero downtime configuration reloads.

> [!NOTE]
> For EC2 instance provisioning, SSH access, and initial Docker Engine setup (`install-docker.sh`), refer to [Lab 01: Host Provisioning](../01-containerized-nextapp/README.md#step-3-provisioning-an-aws-ec2-ubuntu-instance). For the fundamentals of Nginx reverse proxying and Docker Compose, refer to [Lab 02: Reverse Proxy Architecture](../02-nginx-reverse-proxy/README.md).

---

## 🏗️ Architecture & Core Concepts

### 1. The Bootstrapping Challenge (Why Two Nginx Configs?)

Enabling HTTPS with Let's Encrypt presents a classic "chicken-and-egg" bootstrapping dilemma:
- **Nginx with HTTPS (`https.conf`)** cannot start if its configured TLS certificate files (`fullchain.pem`, `privkey.pem`) do not yet exist on disk.
- **Certbot** needs a running web server on port 80 to answer Let's Encrypt's **ACME HTTP-01** challenge before it will issue those certificate files.

```text
Nginx HTTPS requires certificate ──► Certificate requires running web server for ACME challenge ──► (Deadlock)
```

#### The Solution: Two-Stage Bootstrap Workflow

```text
[ Stage 1: Initial Bootstrap ]
   initial-http.conf (Port 80 only)
          │
          ▼
   Nginx starts on port 80 ──► Serves /.well-known/acme-challenge/
          │
          ▼
   Certbot completes ACME challenge ──► Let's Encrypt writes certificates to disk

[ Stage 2: Production HTTPS ]
   https.conf (Port 80 + Port 443)
          │
          ▼
   Nginx loads issued certs ──► Redirects HTTP (80) to HTTPS (443) ──► Proxies securely to Next.js (:3000)
```

The initial configuration is used **only once** to obtain the initial certificate. Once generated, `https.conf` remains active permanently, handling both normal website traffic and future certificate renewals.

---

### 2. Complete End-to-End Request Flow

```text
[ Web Browser / Client ]
           │
           │ 1. DNS Resolution (nginx-https-web.duckdns.org ──► EC2 Public IP)
           ▼
┌────────────────────────────────────────────────────────────────────────┐
│ AWS EC2 Instance (Security Group: Ports 22, 80, 443 Open)             │
│                                                                        │
│   HTTP :80 (Redirect / ACME)                    HTTPS :443 (Secure)    │
│       │                                              │                 │
│       ▼                                              ▼                 │
│ ┌──────────────────────────────────────────────────────────────────┐   │
│ │                     Nginx Container (Alpine)                     │   │
│ │                                                                  │   │
│ │  Port 80 Location:                      Port 443 Location:       │   │
│ │  ├── /.well-known/acme-challenge/       ├── TLS Termination      │   │
│ │  │   (Serves Certbot validation)        ├── Proxy Pass           │   │
│ │  └── / (301 Redirect to HTTPS)          │   (http://next-app:3000│   │
│ └─────────────────────────┬──────────────────────────┬─────────────┘   │
│                           │                          │                 │
│      Shared Host Volume   │                          │ Docker Internal │
│      ./certbot/www        │                          │ Bridge Network  │
│                           ▼                          ▼                 │
│                 ┌──────────────────┐       ┌──────────────────┐        │
│                 │ Certbot Service  │       │ Next.js App      │        │
│                 │ (Runs on-demand) │       │ (Internal :3000) │        │
│                 └──────────────────┘       └──────────────────┘        │
└────────────────────────────────────────────────────────────────────────┘
```

---

### 3. Shared Bind Mount Architecture

Nginx and Certbot coordinate through two shared directories on the EC2 host:

```text
┌──────────────────────┐                           ┌──────────────────────┐
│  Certbot Container   │                           │   Nginx Container    │
│                      │                           │                      │
│   /var/www/certbot   │──[ Read-Write Mount ]──┐  │   /var/www/certbot   │──[ Read-Only Mount ]──┐
│   (Writes challenges)│                        │  │   (Serves challenges)│                       │
│                      │                        │  │                      │                       │
│   /etc/letsencrypt   │──[ Read-Write Mount ]─┐│  │   /etc/letsencrypt   │──[ Read-Only Mount ]─┐│
│   (Saves certs & keys│                       ││  │   (Reads certs)      │                      ││
└──────────────────────┘                       ││  └──────────────────────┘                      ││
                                               ▼▼                                                ▼▼
                              ┌──────────────────────────────────┐
                              │         EC2 Host Storage         │
                              │  ./certbot/www   (Webroot tokens)│
                              │  ./certbot/conf  (Keys & certs)  │
                              └──────────────────────────────────┘
```

- **Challenge Webroot (`./certbot/www`)**: Certbot drops temporary validation tokens into `/var/www/certbot/.well-known/acme-challenge/`. Nginx reads and serves these over HTTP port 80 to prove domain ownership.
- **Certificate Store (`./certbot/conf`)**: When validated, Let's Encrypt writes the certificate bundle and private key into `/etc/letsencrypt/`. Nginx reads them with `:ro` (read-only) permissions to encrypt connections.

---

## 📁 Project Structure

```text
03-nginx-https/
├── .gitignore              # Ignores TLS private keys and live certificates
├── compose.yaml            # Multi-service stack (Next.js, Nginx, Certbot)
├── README.md               # Lab documentation & walkthrough
├── nginx/
│   ├── initial-http.conf   # Stage 1: Port 80 HTTP & ACME validation configuration
│   └── https.conf          # Stage 2: Port 443 HTTPS & HTTP-to-HTTPS redirect configuration
└── certbot/
    ├── conf/               # Persisted Let's Encrypt keys and certificates (Git-ignored!)
    └── www/                # Persisted webroot directory for ACME HTTP-01 challenges
```

> [!WARNING]
> The `certbot/conf/` directory contains your **TLS private key (`privkey.pem`)**. It must **never** be committed to version control. The included [.gitignore](./.gitignore) automatically prevents these sensitive files from being tracked.

---

## ⚙️ Configuration Breakdown

### 1. Docker Compose (`compose.yaml`)

```yaml
services:
  next-app:
    build:
      context: ../01-containerized-nextapp
      dockerfile: Dockerfile

    environment:
      APP_ENV: production
      APP_VERSION: 1.0.0

    expose:
      - "3000"

    restart: unless-stopped

  nginx:
    image: nginx:alpine

    ports:
      - "80:80"
      - "443:443"

    volumes:
      - ./nginx/https.conf:/etc/nginx/conf.d/default.conf:ro
      - ./certbot/www:/var/www/certbot:ro
      - ./certbot/conf:/etc/letsencrypt:ro

    depends_on:
      - next-app

    restart: unless-stopped

  certbot:
    image: certbot/certbot:latest

    volumes:
      - ./certbot/www:/var/www/certbot
      - ./certbot/conf:/etc/letsencrypt
```

#### Line-by-Line Highlights

- **`next-app`**: Reuses the multi-stage Next.js build from Lab 01. `expose: - "3000"` ensures the application port is strictly internal to Docker and unreachable from the internet.
- **`nginx.ports`**: Binds both host port `80` (HTTP / ACME challenges) and port `443` (HTTPS / TLS traffic).
- **`nginx.volumes`**: Mounts the active Nginx configuration as `/etc/nginx/conf.d/default.conf:ro`, along with read-only mounts to the shared Certbot webroot and certificate directories.
- **`certbot`**: Uses the official `certbot/certbot:latest` image. It does not run continuously as a daemon; it runs as an on-demand container via `docker compose run` during initial setup and periodic renewal checks.

---

### 2. Stage 1: Initial HTTP Configuration (`nginx/initial-http.conf`)

Used strictly during initial bootstrapping before certificates exist:

```nginx
server {
    listen 80;
    listen [::]:80;

    server_name nginx-https-web.duckdns.org;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        proxy_pass http://next-app:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

- **`listen 80;` & `listen [::]:80;`**: Listens for HTTP requests on IPv4 and IPv6.
- **`location /.well-known/acme-challenge/`**: Maps ACME challenge requests directly to `/var/www/certbot` where Certbot deposits verification files.
- **`location /`**: Proxies general traffic to Next.js so the app is accessible while certificates are prepared.

---

### 3. Stage 2: Production HTTPS Configuration (`nginx/https.conf`)

Activated after Let's Encrypt successfully issues the certificate:

```nginx
server {
    listen 80;
    listen [::]:80;

    server_name nginx-https-web.duckdns.org;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;

    server_name nginx-https-web.duckdns.org;

    ssl_certificate /etc/letsencrypt/live/nginx-https-web.duckdns.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/nginx-https-web.duckdns.org/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://next-app:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

- **HTTP Server Block (`listen 80`)**:
  - Keeps `/.well-known/acme-challenge/` accessible over port 80 for automated renewal challenges.
  - Redirects all other HTTP traffic (`return 301 https://$host$request_uri;`) to HTTPS permanently, preserving the full URL path and query parameters.
- **HTTPS Server Block (`listen 443 ssl`)**:
  - `ssl_certificate`: Points to the full public certificate chain (`fullchain.pem`).
  - `ssl_certificate_key`: Points to the private key (`privkey.pem`).
  - `ssl_protocols TLSv1.2 TLSv1.3;`: Restricts TLS negotiation to modern, secure protocols, disabling vulnerable legacy ciphers (SSLv3, TLS 1.0, TLS 1.1).
  - `proxy_pass http://next-app:3000;`: Forwards decrypted HTTP traffic to the backend Next.js container.
  - `Upgrade` & `Connection` headers: Ensures WebSocket and Server-Sent Events (SSE) connections pass through cleanly.

---

## 🚀 Step-by-Step Implementation Workflow

### Step 1: Configure DuckDNS Domain

1. Log in to [DuckDNS](https://www.duckdns.org/) using GitHub or another auth provider.
2. In the **Domains** section, create a new subdomain (for example: `nginx-https-web`).
3. Set the target IP address to your **AWS EC2 Public IPv4 Address** and click **update ip**.
4. Test DNS resolution from your terminal:
   ```bash
   dig +short nginx-https-web.duckdns.org
   ```
   *The returned IP must match your EC2 public IPv4 address.*

> [!IMPORTANT]
> If your EC2 instance does not use an AWS Elastic IP, its public IP will change upon stopping and restarting the VM. Remember to update DuckDNS if your IP changes!

---

### Step 2: Configure AWS EC2 Security Group

Update your EC2 Security Group inbound rules to allow both HTTP and HTTPS:

| Type | Protocol | Port Range | Source | Purpose |
| :--- | :---: | :---: | :---: | :--- |
| **SSH** | TCP | `22` | `My IP` (`<your-ip>/32`) | Secure server administration |
| **HTTP** | TCP | `80` | `0.0.0.0/0` | ACME challenge validation & HTTPS redirect |
| **HTTPS** | TCP | `443` | `0.0.0.0/0` | Secure public web traffic |

*(Ensure custom TCP port 3000 is closed to the internet).*

---

### Step 3: Stop Previous Lab & Prepare Directory

Ensure port 80 is not occupied by Lab 02:

```bash
# Stop Lab 02 if running
cd ~/home-labs/02-nginx-reverse-proxy
docker compose down

# Navigate to Lab 03
cd ~/home-labs/03-nginx-https

# Verify ports 80 and 443 are free
sudo ss -lntp | grep -E ':(80|443)\b'
```

---

### Step 4: Create Certbot Directories & Set Permissions

Create the persistent host directories mapped to container volumes:

```bash
mkdir -p certbot/www/.well-known/acme-challenge
mkdir -p certbot/conf

# Ensure current user owns the directories
sudo chown -R "$USER":"$USER" certbot
```

---

### Step 5: Start Initial HTTP Stack & Verify ACME Routing

Before requesting a certificate, start Nginx in HTTP-only mode using `initial-http.conf`.

1. Ensure `compose.yaml` mounts `initial-http.conf`:
   ```yaml
   volumes:
     - ./nginx/initial-http.conf:/etc/nginx/conf.d/default.conf:ro
   ```

2. Start the persistent services:
   ```bash
   docker compose up -d --build next-app nginx
   ```

3. Verify Nginx syntax and test HTTP connectivity:
   ```bash
   docker compose exec nginx nginx -t
   curl -I http://nginx-https-web.duckdns.org
   ```

4. **Sanity Check: Test ACME Challenge Path**:
   Deposit a dummy file in the host webroot and test retrieval through the public domain:
   ```bash
   echo "acme-test-ok" > certbot/www/.well-known/acme-challenge/test-file
   curl http://nginx-https-web.duckdns.org/.well-known/acme-challenge/test-file
   ```
   *Expected output: `acme-test-ok`.* Once confirmed, delete the test file:
   ```bash
   rm certbot/www/.well-known/acme-challenge/test-file
   ```

---

### Step 6: Request Let's Encrypt Certificate via Certbot

Run the Certbot container as a one-off command to perform the HTTP-01 challenge:

```bash
docker compose run --rm certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --email your-email@example.com \
  --agree-tos \
  --no-eff-email \
  -d nginx-https-web.duckdns.org
```

**Flag breakdown:**
- `run --rm`: Starts the container, runs the command, and automatically removes the container when finished.
- `certonly`: Generates the certificate without altering web server configurations directly.
- `--webroot -w /var/www/certbot`: Specifies webroot verification mode and target path.
- `-d nginx-https-web.duckdns.org`: Defines your domain.

Upon success, Certbot outputs:
```text
Successfully received certificate.
Certificate is saved at: /etc/letsencrypt/live/nginx-https-web.duckdns.org/fullchain.pem
Key is saved at:         /etc/letsencrypt/live/nginx-https-web.duckdns.org/privkey.pem
```

Verify that the certificates exist on the EC2 host:
```bash
sudo ls -la certbot/conf/live/nginx-https-web.duckdns.org/
```

---

### Step 7: Transition to Production HTTPS Configuration

1. In [`compose.yaml`](./compose.yaml), update the Nginx volume mount to load [`nginx/https.conf`](./nginx/https.conf):
   ```yaml
   volumes:
     - ./nginx/https.conf:/etc/nginx/conf.d/default.conf:ro
     - ./certbot/www:/var/www/certbot:ro
     - ./certbot/conf:/etc/letsencrypt:ro
   ```

2. Recreate the Nginx container to apply the volume change:
   ```bash
   docker compose up -d --force-recreate nginx
   ```

3. Verify configuration syntax and check running status:
   ```bash
   docker compose exec nginx nginx -t
   docker compose ps
   ```

---

### Step 8: Verify HTTPS & HTTP Redirection

1. **Verify HTTP to HTTPS 301 Redirect**:
   ```bash
   curl -I http://nginx-https-web.duckdns.org
   ```
   *Output should show:*
   ```text
   HTTP/1.1 301 Moved Permanently
   Location: https://nginx-https-web.duckdns.org/
   ```

2. **Verify Secure HTTPS Endpoint**:
   ```bash
   curl -I https://nginx-https-web.duckdns.org
   ```
   *Output should return `HTTP/1.1 200 OK`.*

3. **Inspect the TLS Certificate**:
   ```bash
   openssl s_client -connect nginx-https-web.duckdns.org:443 -servername nginx-https-web.duckdns.org </dev/null 2>/dev/null | openssl x509 -noout -issuer -dates
   ```

4. **Browser Verification**: Open `https://nginx-https-web.duckdns.org` in your browser. Confirm the padlock icon indicates a trusted connection verified by Let's Encrypt!

---

### Step 9: Certificate Renewal Testing & Automation

Let's Encrypt certificates expire after **90 days**. Certbot recommends checking for renewal twice daily.

#### 1. Dry Run Test
Verify that renewal works without replacing existing certificates:
```bash
docker compose run --rm certbot renew --dry-run
```
*A successful test validates that the ACME challenge path remains accessible through `https.conf`.*

#### 2. Automating with Cron
Create a system cron job to check renewals daily at 03:00 AM and reload Nginx when renewed:

```bash
sudo nano /etc/cron.d/homelab-certbot
```

Add the following single-line entry:
```cron
0 3 * * * ubuntu cd /home/ubuntu/home-labs/03-nginx-https && /usr/bin/docker compose run --rm certbot renew --quiet && /usr/bin/docker compose exec -T nginx nginx -s reload >> /var/log/homelab-certbot.log 2>&1
```

Set file permissions and restart the cron daemon:
```bash
sudo chmod 644 /etc/cron.d/homelab-certbot
sudo systemctl restart cron
```

---

## 🛡️ Git Security & `.gitignore`

Because Let's Encrypt stores private keys (`privkey.pem`) locally on the EC2 host, the root of this lab includes a strict [`.gitignore`](./.gitignore):

```gitignore
# Let's Encrypt certificates, private keys, and account metadata
certbot/conf/

# Temporary ACME challenge files
certbot/www/
```

Always verify with `git status` before committing changes to ensure no sensitive cryptographic keys are tracked.

---

## 📋 Useful Commands Reference

| Command | Purpose |
| :--- | :--- |
| `docker compose config` | Validates and renders the merged compose file |
| `docker compose up -d --build next-app nginx` | Builds and launches persistent application and proxy containers |
| `docker compose up -d --force-recreate nginx` | Recreates Nginx to apply modified configuration volume mounts |
| `docker compose exec nginx nginx -t` | Tests Nginx configuration syntax inside the container |
| `docker compose exec nginx nginx -s reload` | Gracefully reloads Nginx configuration without dropping connections |
| `docker compose run --rm certbot certonly ...` | Executes Certbot to issue a new certificate |
| `docker compose run --rm certbot renew --dry-run` | Simulates certificate renewal to verify ACME configuration |
| `docker compose logs -f nginx` | Tails real-time logs for the Nginx proxy |
| `docker compose down` | Stops and tears down the container stack and network |

---

## 🔍 Troubleshooting Guide

### 1. Nginx Fails to Start After Switching to `https.conf`
- **Cause**: Nginx cannot find certificate files defined in `ssl_certificate` / `ssl_certificate_key`.
- **Resolution**:
  - Run `sudo ls -la certbot/conf/live/nginx-https-web.duckdns.org/` to verify files exist.
  - Verify that the volume mount in `compose.yaml` maps `./certbot/conf:/etc/letsencrypt:ro`.
  - Check Nginx startup logs: `docker compose logs --tail=50 nginx`.

### 2. ACME Challenge Returns `404 Not Found`
- **Cause**: The challenge token is placed in the wrong folder or Nginx root directory mismatch.
- **Resolution**: Ensure the test file is deposited in `certbot/www/.well-known/acme-challenge/` and verify Nginx can read it with:
  ```bash
  docker compose exec nginx cat /var/www/certbot/.well-known/acme-challenge/test-file
  ```

### 3. Certbot Reports "Unauthorized / Could not connect"
- **Cause**: DNS resolution failed or inbound port 80 is blocked.
- **Resolution**:
  - Confirm DuckDNS points to the current EC2 IP: `dig +short nginx-https-web.duckdns.org`.
  - Confirm AWS Security Group allows inbound TCP traffic on port `80` from `0.0.0.0/0`.

### 4. Browser Connection Times Out on HTTPS (`443`)
- **Cause**: Inbound port 443 is blocked in AWS Security Group or not mapped in `compose.yaml`.
- **Resolution**:
  - Verify port 443 is published: `docker compose ps` (should show `0.0.0.0:443->443/tcp`).
  - Verify AWS EC2 Security Group contains an inbound rule for HTTPS (`443`) from `0.0.0.0/0`.

---

## 💡 Key Takeaways & Lessons Learned

- **TLS Termination at the Edge**: Offloading cryptographic decryption to Nginx frees the application container from managing certificates and private keys.
- **Bootstrapping Complex Stacks**: Infrastructure requiring TLS certificates must plan for a transitional bootstrapping phase to satisfy external certificate authority challenges.
- **Least Privilege Mounts**: Mounting certificates into Nginx with the `:ro` (read-only) flag ensures the web server cannot inadvertently alter or delete cryptographic keys.
- **Stateless Automation**: Decoupling Certbot as a transient command-line container rather than a permanently running daemon keeps the system lean and predictable.

---

## 🧭 Navigation

- ⬅️ **Previous Lab**: [Lab 02: Nginx Reverse Proxy with Docker Compose](../02-nginx-reverse-proxy/README.md)
- 📦 **Application Source**: [Lab 01: Containerized Next.js App](../01-containerized-nextapp/README.md)
- 🏠 **Home**: [Home Labs Overview](../README.md)
