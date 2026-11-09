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
           │ 1. DNS Resolution (<your-domain>.duckdns.org ──► EC2 Public IP)
           ▼
┌────────────────────────────────────────────────────────────────────────┐
│ AWS EC2 Instance (Security Group: Ports 22, 80, 443 Open)              │
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
│ │  └── / (301 Redirect to HTTPS)          │   (http://next-app:3000)│  │
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

Rather than packaging certificates directly inside container images or running Certbot as a permanent daemon, Nginx and Certbot communicate by sharing two directories directly on the EC2 host using Docker bind mounts:

1. **ACME Challenge Webroot (`./certbot/www` ⮂ `/var/www/certbot`)**:
   - **Certbot (Read-Write)**: During the HTTP-01 challenge, Certbot generates a temporary validation token and writes it to `/var/www/certbot/.well-known/acme-challenge/` inside its container, which instantly reflects in `./certbot/www` on the host.
   - **Nginx (Read-Only `:ro`)**: Nginx mounts the same host directory and serves any request hitting `/.well-known/acme-challenge/*` over HTTP port 80. This allows Let's Encrypt to verify domain ownership without giving Nginx write permissions to the webroot.

2. **Certificate Storage (`./certbot/conf` ⮂ `/etc/letsencrypt`)**:
   - **Certbot (Read-Write)**: Once domain validation succeeds, Let's Encrypt issues the certificate bundle (`fullchain.pem`) and private key (`privkey.pem`), which Certbot stores in `/etc/letsencrypt/`, persisting them directly onto the host filesystem at `./certbot/conf/`.
   - **Nginx (Read-Only `:ro`)**: Nginx mounts `./certbot/conf` as `/etc/letsencrypt:ro` to load the public certificates and private keys required to terminate TLS on port 443. The read-only constraint ensures that even if Nginx is compromised, the stored cryptographic keys cannot be deleted or modified.


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

    server_name <your-domain>.duckdns.org;

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
- **`server_name <your-domain>.duckdns.org;`**: Matches requests for your configured DuckDNS subdomain.
- **`location /.well-known/acme-challenge/`**: Maps ACME challenge requests directly to `/var/www/certbot` where Certbot deposits verification files.
- **`location /`**: Proxies general traffic to Next.js so the app is accessible while certificates are prepared.

---

### 3. Stage 2: Production HTTPS Configuration (`nginx/https.conf`)

Activated after Let's Encrypt successfully issues the certificate:

```nginx
server {
    listen 80;
    listen [::]:80;

    server_name <your-domain>.duckdns.org;

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

    server_name <your-domain>.duckdns.org;

    ssl_certificate /etc/letsencrypt/live/<your-domain>.duckdns.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/<your-domain>.duckdns.org/privkey.pem;

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

[DuckDNS](https://www.duckdns.org/) is a free dynamic DNS service that maps human-readable domain names (`<your-domain>.duckdns.org`) to changing or static public IP addresses.

#### How to Create and Configure Your Subdomain:
1. Navigate to [DuckDNS](https://www.duckdns.org/) and log in using an account provider (such as GitHub, Google, or Reddit).
2. Under the **Domains** section on your account dashboard:
   - Type your desired subdomain name into the input field (e.g., enter `my-homelab` to get `my-homelab.duckdns.org`). In this guide, we use `<your-domain>` as the placeholder.
   - Click the **add domain** button.
3. In the **current ip** field next to your newly created domain, enter your **AWS EC2 Public IPv4 Address**.
4. Click the **update ip** button to point the domain to your EC2 instance.
5. Verify DNS propagation and resolution from your terminal:
   ```bash
   dig +short <your-domain>.duckdns.org
   ```
   *The returned IP must match your EC2 instance's public IPv4 address.*

> [!IMPORTANT]
> If your EC2 instance does not use an AWS Elastic IP, its public IP changes every time you stop and restart the VM. Whenever your EC2 instance restarts with a new public IP, log in to DuckDNS and update the domain's target IP to match the new address.

---

### Step 2: Configure AWS EC2 Security Group

1. Open the **AWS EC2 Console** -> **Instances** -> Select your running instance.
2. In the details pane, navigate to the **Security** tab and click on the associated **Security Group ID**.
3. Under **Inbound Rules**, click **Edit inbound rules** and ensure the following rules are configured:

   | Type | Protocol | Port Range | Source | Purpose |
   | :--- | :---: | :---: | :---: | :--- |
   | **SSH** | TCP | `22` | `My IP` (`<your-ip>/32`) | Secure server administration |
   | **HTTP** | TCP | `80` | `0.0.0.0/0` | ACME challenge validation & HTTPS redirect |
   | **HTTPS** | TCP | `443` | `0.0.0.0/0` | Secure public web traffic |

4. Click **Save rules**. *(Ensure port 3000 is not exposed to the public internet).*

---

### Step 3: Stop Previous Lab & Prepare Directory

1. Stop Lab 02 if it is currently running to free host port 80:
   ```bash
   cd ~/home-labs/02-nginx-reverse-proxy
   docker compose down
   ```
2. Navigate to the Lab 03 workspace:
   ```bash
   cd ~/home-labs/03-nginx-https
   ```
3. Verify that ports 80 and 443 are not in use:
   ```bash
   sudo ss -lntp | grep -E ':(80|443)\b'
   ```

---

### Step 4: Create Certbot Directories & Set Permissions

1. Create the persistent host directories mapped to container volumes:
   ```bash
   mkdir -p certbot/www/.well-known/acme-challenge
   mkdir -p certbot/conf
   ```
2. Set ownership of the directory to the current user to prevent permission issues:
   ```bash
   sudo chown -R "$USER":"$USER" certbot
   ```

---

### Step 5: Start Initial HTTP Stack

1. Verify declared services in the Compose stack:
   ```bash
   docker compose config --services
   ```
2. Ensure [`compose.yaml`](./compose.yaml) initially mounts `initial-http.conf`:
   ```yaml
   volumes:
     - ./nginx/initial-http.conf:/etc/nginx/conf.d/default.conf:ro
   ```
3. Build and launch `next-app` and `nginx` in detached mode:
   ```bash
   docker compose up -d --build next-app nginx
   ```
4. Verify container status and Nginx configuration syntax:
   ```bash
   docker compose ps
   docker compose exec nginx nginx -t
   ```
5. Test standard HTTP connectivity:
   ```bash
   curl -I http://<your-domain>.duckdns.org
   ```

---

### Step 6: Test ACME Challenge Path

1. Create a dummy challenge verification file on the host:
   ```bash
   echo "acme-test-ok" > certbot/www/.well-known/acme-challenge/test-file
   ```
2. Verify that the Nginx container can access the file through the bind mount:
   ```bash
   docker compose exec nginx cat /var/www/certbot/.well-known/acme-challenge/test-file
   ```
3. Test public HTTP access to the challenge file through DuckDNS:
   ```bash
   curl http://<your-domain>.duckdns.org/.well-known/acme-challenge/test-file
   ```
   *Expected output: `acme-test-ok`.*
4. Clean up the temporary test file:
   ```bash
   rm certbot/www/.well-known/acme-challenge/test-file
   ```

---

### Step 7: Request Let's Encrypt Certificate via Certbot

1. Run the Certbot container as a temporary one-off service to execute the ACME HTTP-01 challenge:
   ```bash
   docker compose run --rm certbot certonly \
     --webroot \
     --webroot-path /var/www/certbot \
     --email your-email@example.com \
     --agree-tos \
     --no-eff-email \
     -d <your-domain>.duckdns.org
   ```
   **Flag breakdown:**
   - `run --rm`: Runs the command in a new container and automatically removes it when complete.
   - `certonly`: Requests the certificate without attempting to configure Nginx automatically.
   - `--webroot -w /var/www/certbot`: Uses webroot verification mode, depositing challenge tokens in the shared volume.
   - `-d <your-domain>.duckdns.org`: Defines your custom DuckDNS domain name.

2. Verify that the certificate and private key files were created on the EC2 host:
   ```bash
   sudo ls -la certbot/conf/live/<your-domain>.duckdns.org/
   ```
   *Expected files: `cert.pem`, `chain.pem`, `fullchain.pem`, and `privkey.pem`.*

---

### Step 8: Switch from HTTP Mode to HTTPS Mode

1. Update the Nginx volume mount in [`compose.yaml`](./compose.yaml) to load [`nginx/https.conf`](./nginx/https.conf):
   ```yaml
   volumes:
     - ./nginx/https.conf:/etc/nginx/conf.d/default.conf:ro
     - ./certbot/www:/var/www/certbot:ro
     - ./certbot/conf:/etc/letsencrypt:ro
   ```
2. Recreate the Nginx container to apply the updated configuration mount:
   ```bash
   docker compose up -d --force-recreate nginx
   ```
3. Test the active configuration syntax:
   ```bash
   docker compose exec nginx nginx -t
   ```

---

### Step 9: Test HTTPS & HTTP Redirection

1. Test the automatic HTTP to HTTPS 301 permanent redirect:
   ```bash
   curl -I http://<your-domain>.duckdns.org
   ```
   *Expected output:*
   ```text
   HTTP/1.1 301 Moved Permanently
   Location: https://<your-domain>.duckdns.org/
   ```
2. Test the secure HTTPS endpoint:
   ```bash
   curl -I https://<your-domain>.duckdns.org
   ```
   *Expected output: `HTTP/1.1 200 OK`.*
3. Inspect the remote TLS certificate details:
   ```bash
   openssl s_client -connect <your-domain>.duckdns.org:443 -servername <your-domain>.duckdns.org </dev/null 2>/dev/null | openssl x509 -noout -issuer -dates
   ```
4. Verify in a web browser: Navigate to `https://<your-domain>.duckdns.org` and confirm that the padlock icon indicates a trusted connection verified by Let's Encrypt.

---

### Step 10: Test Certificate Renewal

1. Perform a renewal simulation (dry run) with Certbot:
   ```bash
   docker compose run --rm certbot renew --dry-run
   ```
   *A successful dry run confirms that the ACME challenge path remains accessible through `https.conf`.*
2. Test reloading the Nginx configuration without stopping the container:
   ```bash
   docker compose exec nginx nginx -s reload
   ```

---

### Step 11: Automate Certificate Renewal with Cron

1. Create a system cron job file on the EC2 host:
   ```bash
   sudo nano /etc/cron.d/homelab-certbot
   ```
2. Add the scheduled daily renewal check and Nginx reload command:
   ```cron
   0 3 * * * ubuntu cd /home/ubuntu/home-labs/03-nginx-https && /usr/bin/docker compose run --rm certbot renew --quiet && /usr/bin/docker compose exec -T nginx nginx -s reload >> /var/log/homelab-certbot.log 2>&1
   ```
3. Set appropriate permissions and restart the cron service:
   ```bash
   sudo chmod 644 /etc/cron.d/homelab-certbot
   sudo systemctl restart cron
   ```
4. Verify that the cron daemon is active and running:
   ```bash
   sudo systemctl status cron --no-pager
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
  - Run `sudo ls -la certbot/conf/live/<your-domain>.duckdns.org/` to verify files exist.
  - Verify that the volume mount in `compose.yaml` maps `./certbot/conf:/etc/letsencrypt:ro`.
  - Check Nginx startup logs: `docker compose logs --tail=50 nginx`.

### 2. ACME Challenge Returns `404 Not Found`
- **Cause**: The challenge token is placed in the wrong folder or Nginx root directory mismatch.
- **Resolution**: Ensure the test file is deposited in `certbot/www/.well-known/acme-challenge/` and verify Nginx can read it with:
  ```bash
  docker compose exec nginx cat /var/www/certbot/.well-known/acme-challenge/test-file
  ```

### 3. Certbot Reports "Unauthorized / Could Not Connect"
- **Cause**: DNS resolution failed or inbound port 80 is blocked.
- **Resolution**:
  - Confirm DuckDNS points to the current EC2 IP: `dig +short <your-domain>.duckdns.org`.
  - Confirm AWS Security Group allows inbound TCP traffic on port `80` from `0.0.0.0/0`.

### 4. Browser Connection Times Out on HTTPS (`443`)
- **Cause**: Inbound port 443 is blocked in AWS Security Group or not mapped in `compose.yaml`.
- **Resolution**:
  - Verify port 443 is published: `docker compose ps` (should show `0.0.0.0:443->443/tcp`).
  - Verify AWS EC2 Security Group contains an inbound rule for HTTPS (`443`) from `0.0.0.0/0`.

### 5. Nginx Cannot Reach Next.js Container (`502 Bad Gateway`)
- **Cause**: The `next-app` container is stopped or Nginx cannot resolve its service hostname.
- **Resolution**:
  - Check Next.js container status: `docker compose ps next-app`.
  - Verify internal container connectivity from Nginx:
    ```bash
    docker compose exec nginx wget -qO- http://next-app:3000
    ```

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
