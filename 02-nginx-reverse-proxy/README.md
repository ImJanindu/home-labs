# Lab 02: Nginx Reverse Proxy with Docker Compose

A hands-on implementation of a multi-container architecture on AWS EC2 using **Docker Compose** and **Nginx** as a reverse proxy in front of the containerized Next.js application built in [Lab 01](../01-containerized-nextapp/README.md).

---

## Overview & Lab Objectives

In [Lab 01](../01-containerized-nextapp/README.md), we containerized a Next.js application and accessed it directly over port `3000` by exposing that port to the internet in our AWS Security Group. While functional, exposing application runtime ports directly to the public internet is not production best practice.

In this lab, we elevate the architecture by introducing **Nginx** as a reverse proxy:
1. **Multi-Container Orchestration**: Use **Docker Compose** to define, build, and run both the Next.js app and Nginx as a unified stack.
2. **Reverse Proxying**: Route incoming standard HTTP traffic (port `80`) to the internal Next.js application container (port `3000`).
3. **Internal Network Isolation**: Isolate the Next.js container from the public internet using Docker's internal networking (`expose` instead of `ports`).
4. **Seamless Public Access**: Access the application directly via `http://<EC2_PUBLIC_IP>` without specifying any custom port number in the browser.

> [!NOTE]
> For instructions on launching the EC2 instance, connecting via SSH, and running the automated Docker Engine setup script (`install-docker.sh`), refer to [Lab 01: Provisioning & Docker Setup](../01-containerized-nextapp/README.md#step-3-provisioning-an-aws-ec2-ubuntu-instance).

---

## Architecture: How Nginx Acts as a Reverse Proxy

A **reverse proxy** sits between external clients (web browsers) and backend servers (our Next.js application). External clients only ever talk to Nginx on standard HTTP port `80`. Nginx then forwards the request internally to Next.js on port `3000` and passes the response back.

### Request Flow Diagram

```text
[ Web Browser / Client ]
           │
           │  HTTP Request (Port 80)
           ▼
┌────────────────────────────────────────────────────────────────────────┐
│ AWS EC2 Instance (Security Group: Port 80 Open, Port 3000 Closed)     │
│                                                                        │
│   Host Port :80                                                        │
│         │                                                              │
│         ▼                                                              │
│   ┌───────────────┐     Docker Internal Network     ┌───────────────┐  │
│   │     nginx     │ ──────────────────────────────> │   next-app    │  │
│   │  (Port :80)   │    proxy_pass http://next-app:3000 (Port :3000) │  │
│   └───────────────┘ <────────────────────────────── └───────────────┘  │
│         │                  HTTP Response                    │          │
└─────────┼───────────────────────────────────────────────────┼──────────┘
          │                                                   │
          └──────────────── Return to Client ─────────────────┘
```

### Why Use Nginx as a Reverse Proxy?
- **Standard Web Ports**: Users can access the website cleanly on standard HTTP (port `80`) without appending ugly port numbers like `:3000` to the URL.
- **Enhanced Security**: The Next.js container is never directly reachable from the outside world. Port `3000` is kept strictly within Docker's private bridge network.
- **Client IP & Header Preservation**: Nginx passes real client IPs and request protocols to the backend using proxy headers.
- **Production Readiness**: Nginx serves as the ideal foundation for adding SSL/TLS termination (HTTPS on port 443), rate limiting, caching, and load balancing in future labs.

---

## Project Structure

```text
02-nginx-reverse-proxy/
├── compose.yaml          # Multi-container Docker Compose configuration
├── README.md             # Lab documentation and walkthrough
└── nginx/
    └── default.conf      # Nginx server block & reverse proxy routing rules
```

This lab reuses the Next.js application source code and multi-stage [Dockerfile](../01-containerized-nextapp/Dockerfile) directly from `01-containerized-nextapp`.

---

## Configuration Breakdown

### 1. Docker Compose (`compose.yaml`)

Docker Compose allows us to declare and run both services (`next-app` and `nginx`) together with a single command.

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

    restart: unless-stopped # restarts the container after crashes, unless manually stopped it.
  
  nginx:
    image: nginx:alpine

    ports:
      - "80:80" # maps container port 80 to host port 80

    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro  # :ro sets the config read-only inside the container

    depends_on:
      - next-app

    restart: unless-stopped
```

#### Line-by-Line Code Explanation

- **`services:`**: Top-level section defining the containers to run.
- **`next-app:`**: Name of our backend application service.
  - **`build.context: ../01-containerized-nextapp`**: Points to the Lab 01 directory where the Next.js source code resides.
  - **`build.dockerfile: Dockerfile`**: Uses the multi-stage Dockerfile from Lab 01 to build the Next.js production image.
  - **`environment:`**: Injects runtime environment variables (`APP_ENV=production` and `APP_VERSION=1.0.0`) into the Next.js container.
  - **`expose: - "3000"`**: **Crucial concept!** Unlike `ports`, `expose` does **not** publish port 3000 to the EC2 host or the public internet. It only opens port 3000 to other containers connected to the same internal Docker network (allowing Nginx to talk to it).
  - **`restart: unless-stopped`**: Automatically restarts the container if it crashes or when the EC2 host reboots.
- **`nginx:`**: Name of our reverse proxy service.
  - **`image: nginx:alpine`**: Uses the official lightweight Alpine-based Nginx image (~20MB).
  - **`ports: - "80:80"`**: Maps port `80` on the EC2 host machine to port `80` inside the Nginx container, making Nginx publicly accessible.
  - **`volumes: - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro`**: Mounts our local Nginx configuration file into Nginx's configuration directory inside the container. `:ro` marks the mount as **read-only** so the container cannot modify host files.
  - **`depends_on: - next-app`**: Ensures Docker Compose starts `next-app` before launching `nginx`.

> [!TIP]
> **Key Difference: `ports` vs `expose`**  
> - `ports: ["80:80"]` binds host port 80 to container port 80, opening it to external traffic.  
> - `expose: ["3000"]` makes port 3000 reachable **only** to sibling containers on the internal Docker bridge network. External traffic cannot access port 3000 directly.

---

### 2. Nginx Configuration (`nginx/default.conf`)

The Nginx configuration file defines how incoming traffic on port 80 is forwarded to the Next.js application:

```nginx
server {
    listen 80;
    server_name _;

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

#### Line-by-Line Code Explanation

- **`listen 80;`**: Directs Nginx to listen for incoming HTTP connections on port 80.
- **`server_name _;`**: A catch-all wildcard matching any hostname or IP address reaching this server.
- **`location / { ... }`**: Handles all incoming requests sent to the root path and subpaths.
- **`proxy_pass http://next-app:3000;`**: **Docker DNS magic!** Docker provides automatic embedded DNS resolution. Nginx uses the service name `next-app` defined in `compose.yaml` to resolve the internal private IP of the Next.js container on port 3000.
- **`proxy_http_version 1.1;`**: Uses HTTP/1.1 for proxying (required for persistent connections and WebSocket support).
- **`proxy_set_header Host $host;`**: Passes the original host header requested by the client to Next.js.
- **`proxy_set_header X-Real-IP $remote_addr;`**: Passes the real public IP address of the client to the backend application instead of Nginx's internal container IP.
- **`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`**: Appends the client's IP to a comma-separated list of proxies the request has traversed.
- **`proxy_set_header X-Forwarded-Proto $scheme;`**: Informs the backend whether the original request was `http` or `https`.
- **`proxy_set_header Upgrade $http_upgrade;` & `Connection "upgrade";`**: Enables WebSocket pass-through, necessary for Next.js Fast Refresh and streaming features.

---

## EC2 Setup & Deployment

Since host VM provisioning and Docker installation were covered in [Lab 01](../01-containerized-nextapp/README.md), this section focuses specifically on what changes in Lab 02.

### Step 1: AWS Security Group Configuration

In Lab 01, we had to open port `3000`. In Lab 02, we **no longer need port 3000 open**. We only expose standard HTTP port `80`:

1. Open the **AWS EC2 Console** -> **Instances** -> Select your instance.
2. In the **Security** tab, click on your **Security Group**.
3. Under **Inbound Rules**, click **Edit inbound rules**:
   - **Remove**: Custom TCP rule for port `3000` (if present from Lab 01).
   - **Add Rule**:
     - **Type**: `HTTP`
     - **Port range**: `80`
     - **Source**: `0.0.0.0/0` (Anywhere IPv4)
     - **Description**: `Nginx Reverse Proxy HTTP`
   - *(Keep SSH on port 22 open for administrative access)*
4. Click **Save rules**.

---

### Step 2: Deploying with Docker Compose

1. SSH into your EC2 instance:
   ```bash
   ssh -i /path/to/your-key.pem ubuntu@<EC2_PUBLIC_IP>
   ```

2. Navigate into the `02-nginx-reverse-proxy` directory:
   ```bash
   cd home-labs/02-nginx-reverse-proxy
   ```

3. Build images and start both containers in detached mode:
   ```bash
   docker compose up -d --build
   ```

   **What Docker Compose does here:**
   - Builds the Next.js image using the Dockerfile from `../01-containerized-nextapp`.
   - Pulls the `nginx:alpine` image.
   - Creates a dedicated Docker bridge network (`02-nginx-reverse-proxy_default`).
   - Starts `next-app` container first.
   - Starts `nginx` container and attaches the read-only volume.

4. Verify that both containers are running:
   ```bash
   docker compose ps
   ```

   Output should show both containers in the `Up` state:
   ```text
   NAME                            IMAGE                 COMMAND                  SERVICE      STATUS      PORTS
   02-nginx-reverse-proxy-next-app 02-nginx-...-next-app "bun server.js"          next-app     Up          3000/tcp
   02-nginx-reverse-proxy-nginx    nginx:alpine          "/docker-entrypoint.…"   nginx        Up          0.0.0.0:80->80/tcp
   ```

---

### Step 3: Accessing the Website

Open your web browser and navigate directly to:

```text
http://<EC2_PUBLIC_IP>
```

> [!NOTE]
> **No Port Needed!**  
> Browsers automatically default to port `80` when navigating over `http://`. Nginx receives the connection on port 80 and immediately proxies it internally to `next-app:3000`. The Next.js dashboard renders seamlessly without exposing port 3000 to the public.

---

## Useful Docker Compose Commands Reference

| Command | Description |
| :--- | :--- |
| `docker compose up -d` | Starts all services in background (detached mode) |
| `docker compose up -d --build` | Rebuilds images if code changed, then starts services |
| `docker compose ps` | Displays the status and port mappings of all running services |
| `docker compose logs -f` | Follows live logs of all services simultaneously |
| `docker compose logs -f nginx` | Follows live logs exclusively for the Nginx proxy |
| `docker compose logs -f next-app` | Follows live logs exclusively for the Next.js app |
| `docker compose restart nginx` | Restarts the Nginx container (useful after config updates) |
| `docker compose down` | Stops and removes all containers and networks for this stack |

---

## Key Takeaways & Lessons Learned

- **Decoupled Architecture**: Separating the web server/proxy layer (Nginx) from the application runtime (Next.js) creates a modular, scalable architecture.
- **Port Security via `expose`**: Using `expose` instead of `ports` ensures sensitive application ports are strictly unreachable outside the Docker internal network.
- **Docker Embedded DNS**: Docker Compose automatically configures internal DNS, allowing services to communicate via their service names (`next-app`) rather than fragile, hardcoded IP addresses.
- **Clean User Experience**: Forwarding port 80 eliminates the need for non-standard port numbers in public URLs, aligning the deployment with real-world web standards.

---

## Navigation

- ⬅️ **Previous Lab**: [Lab 01: Containerized Next.js App on AWS EC2](../01-containerized-nextapp/README.md)
- ➡️ **Next Lab**: [Lab 03: Nginx HTTPS with Certbot & DuckDNS](../03-nginx-https/README.md)
- 🏠 **Home**: [Home Labs Overview](../README.md)

