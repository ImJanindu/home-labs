# Lab 04: Automated CI/CD Pipeline with GitHub Actions

A practical implementation of Continuous Integration and Continuous Deployment (CI/CD) to decouple the Docker build process from the production server and automate deployments using GitHub Actions and the GitHub Container Registry (GHCR).

## Overview & Lab Objectives

The goal of this lab was to transition from manual, error-prone server deployments to a fully automated pipeline:

1. **Decouple Build from Host**: Stop consuming EC2 CPU/memory to build Docker images. Offload compilation to GitHub's remote runners.

2. **Automate Image Registry**: Use GitHub Actions to automatically build and push the Next.js image to the GitHub Container Registry (GHCR).

3. **Secure SSH Deployment**: Configure a dedicated, passphrase-less ed25519 SSH deployment key to allow GitHub Actions to trigger updates on the EC2 instance securely.

4. **Zero-Touch Updates**: Ensure that pushing to the `main` branch automatically pulls the latest pre-built image and restarts the container on the server with zero manual intervention.

## Architecture & Request Flow

```
Developer pushes code to the main branch
                   ↓
GitHub Actions Runner triggers the workflow
                   ↓
Runner builds the Next.js Docker image
                   ↓
Runner pushes the image to GitHub Container Registry (GHCR)
                   ↓
Runner connects to AWS EC2 instance via SSH
                   ↓
EC2 pulls the pre-built image from GHCR
                   ↓
EC2 restarts the Next.js container via Docker Compose

```

## Project Structure Updates

```
.github/
└── workflows/
    └── ci.yml           # The CI/CD pipeline definition for GitHub Actions
01-containerized-nextapp/
└── compose.yaml         # Updated to use the pre-built GHCR image

```

## Implementation Steps

### Step 1: Secure Authentication & Secrets

To allow GitHub Actions to connect to the EC2 instance without exposing credentials, a dedicated SSH key pair was generated specifically for deployment:

```
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/github_actions_key

```

The public key was appended to the EC2 `~/.ssh/authorized_keys` file. The private key and server details were added as **Repository Secrets** in GitHub (`Settings > Secrets and variables > Actions`):

* `EC2_HOST`: The public IPv4 address of the EC2 instance.

* `EC2_USERNAME`: `ubuntu`

* `EC2_SSH_KEY`: The private ed25519 key.

*Note: Repository secrets were chosen over Environment secrets because this homelab utilizes a single deployment target rather than isolated Staging/Production environments.*

### Step 2: The Continuous Integration (CI) Workflow

Before automating the server deployment, the build process was automated. An initial `.github/workflows/ci.yml` file was created to only build and push the image to GHCR.

```
name: Build and Push Next.js Image

on:
  push:
    branches:
      - main

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Log in to the Container registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata (tags, labels) for Docker
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=raw,value=latest
            type=sha

      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: ./01-containerized-nextapp
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}

```

#### Line-by-Line Breakdown of the CI Workflow & Variables

| Instruction / Variable | What It Does In This Pipeline | 
| ----- | ----- | 
| **`on: push: branches: [main]`** | Triggers the workflow automatically whenever new code is pushed specifically to the `main` branch. | 
| **`env.REGISTRY`** | Set to `ghcr.io`, explicitly defining the GitHub Container Registry as the target host for the built image. | 
| **`${{ github.repository }}`** | A built-in GitHub context variable that dynamically outputs the owner and repository name (e.g., `ImJanindu/home-labs`). Used to automatically name the image without hardcoding. | 
| **`runs-on: ubuntu-latest`** | Provisions a fresh, ephemeral Ubuntu virtual machine hosted by GitHub to execute the steps. | 
| **`permissions: packages: write`** | Modifies the default `GITHUB_TOKEN` permissions, granting the runner authorization to upload the built image to the registry. | 
| **`actions/checkout@v4`** | Clones the repository source code into the runner's workspace so Docker has access to the Dockerfile. | 
| **`${{ github.actor }}`** | A built-in context variable that outputs the username of the account that triggered the workflow, used as the Docker login username. | 
| **`${{ secrets.GITHUB_TOKEN }}`** | An ephemeral, automatically generated secret provided by GitHub per workflow run. It grants secure access to push to GHCR without requiring a manual, long-lived Personal Access Token (PAT). | 
| **`docker/metadata-action@v5`** | Automatically generates standard Docker tags. It tags the image with `latest` and the specific Git commit SHA for version control. | 
| **`docker/build-push-action@v5`** | Executes the multi-stage Dockerfile located in `./01-containerized-nextapp` and pushes the final compiled image to GHCR. | 

### Step 3: Making the GHCR Package Public

By default, images pushed to the GitHub Container Registry are private. This would cause the EC2 instance to fail when attempting to pull the image unless it was explicitly authenticated.

To resolve this, the package visibility was manually updated in the GitHub UI:

1. Navigated to the repository's **Packages** section.

2. Selected the newly built image.

3. Accessed **Package settings** and changed visibility to **Public** in the Danger Zone.

### Step 4: The Deployment Configuration (`compose.yaml`)

Because the image is now built remotely, the EC2 instance no longer requires a `build: .` directive. A new `compose.yaml` file was introduced in `01-containerized-nextapp` to pull the public, pre-built image directly from GHCR.

```
services:
  next-app:
    image: ghcr.io/imjanindu/home-labs:latest
    container_name: next-app
    ports:
      - "3000:3000"
    restart: unless-stopped

```

### Step 5: Adding the Continuous Deployment (CD) Job

Once the image was public and the Compose file was ready, the `ci.yml` file was updated to include a `deploy` job. This job logs into the EC2 instance and triggers the update.

```
  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Execute deployment commands via SSH
        uses: appleboy/ssh-action@v1.0.3
        with:
          host: ${{ secrets.EC2_HOST }}
          username: ${{ secrets.EC2_USERNAME }}
          key: ${{ secrets.EC2_SSH_KEY }}
          script: |
            cd /home/ubuntu/home-labs
            git pull origin main
            cd 01-containerized-nextapp
            docker compose pull
            docker compose up -d

```

#### Line-by-Line Breakdown of the CD Job

| Instruction | What It Does In This Pipeline | 
| ----- | ----- | 
| **`needs: build`** | Ensures the `deploy` job waits for the `build` job to finish successfully. If the build fails, the deployment is canceled. | 
| **`appleboy/ssh-action@v1.0.3`** | A pre-built action that establishes a secure SSH connection to the remote EC2 server using the provided repository secrets. | 
| **`git pull origin main`** | Updates the local repository on the EC2 instance so it has the latest `compose.yaml` and Nginx configurations. | 
| **`docker compose pull`** | Reaches out to GHCR and downloads the updated `latest` image compiled in the previous job. | 
| **`docker compose up -d`** | Recreates the container with the new image. Docker Compose handles this with minimal downtime, replacing the old container with the new one. | 

### Step 6: Controlling Workflow Execution

To avoid running the pipeline on trivial updates (like updating this README), GitHub Actions supports native skipping. Adding `[skip ci]` to a commit message instructs GitHub to ignore the push and cancel the workflow execution.
*Example: `git commit -m "Update docs [skip ci]"`*

To completely pause deployments during heavy debugging, the workflow can be disabled entirely via the GitHub UI under the **Actions** tab by selecting the workflow and clicking **Disable workflow**.

## Running Multiple Applications from the Same Repository

The same repository can contain multiple Next.js applications and each application can have its own independent CI/CD workflow. In this lab, a second Next.js application was added inside `01-containerized-nextapp/second-web-app` and configured to run on port `3001`, while the original application continues to run on port `3000`.

### Using Separate Container Image Names

Each workflow publishes its application to a separate package in the GitHub Container Registry by adding an application-specific name to `IMAGE_NAME`:

```yaml
# First application
IMAGE_NAME: ${{ github.repository }}/firstapp

# Second application
IMAGE_NAME: ${{ github.repository }}/secondapp
```

This keeps the images separate while using the same repository and allows each EC2 deployment to pull only the image belonging to its application.

### Deploying Applications on Separate Ports

Each application uses its own Compose configuration, container name, and host port:

| Application | Container Image | Container Name | Host Port |
| :--- | :--- | :--- | :---: |
| First Next.js app | `ghcr.io/imjanindu/home-labs/firstapp:latest` | `next-app-1` | `3000` |
| Second Next.js app | `ghcr.io/imjanindu/home-labs/secondapp:latest` | `next-app-2` | `3001` |

Using distinct container names (`next-app-1` and `next-app-2`) prevents naming conflicts on the EC2 host. Both workflows can run in parallel because they build and publish separate container images, then deploy their corresponding application independently.

### Limiting Workflow Triggers with `paths`

The `paths` keyword limits workflow execution to changes in the application directory or its corresponding workflow file. This prevents unrelated repository changes from starting the deployment pipeline:

```yaml
on:
  push:
    branches:
      - main
    paths:
      - '01-containerized-nextapp/**'
      - '.github/workflows/lab01-nextapp-first.yml'
```

The second workflow uses the same approach with `.github/workflows/lab01-nextapp-second.yml`. This makes it possible to manage multiple applications in one repository while keeping their build, package, and deployment workflows organized independently.


## Lessons Learned & Key Takeaways

* **Resource Optimization:** EC2 instances (especially `t2.micro` or `t3.micro`) can crash or run out of memory when building heavy Node.js/Bun applications. Offloading this to GitHub Actions keeps the server stable and dedicated strictly to serving traffic.

* **Short-Lived Credentials:** Using the automatically injected `GITHUB_TOKEN` for registry authentication prevents the security risks associated with hardcoding or storing permanent access tokens.

* **Image Visibility:** Setting the GHCR package visibility to "Public" allows the EC2 instance to pull the image seamlessly without requiring a Docker login step on the host machine.

* **Pipeline Phasing:** Separating the pipeline into independent `build` and `deploy` jobs provides clearer logs, easier troubleshooting, and the ability to strictly enforce that deployments only happen if compilation succeeds.

* **Multiple Applications in One Repository:** Separate workflows can build and deploy multiple Next.js applications in parallel while keeping each application's source path, container image, and deployment configuration organized independently.

* **Unique Image and Container Names:** Adding names such as `${{ github.repository }}/firstapp` and `${{ github.repository }}/secondapp`, together with Compose container names `next-app-1` and `next-app-2`, prevents conflicts between applications.

* **Targeted Workflow Triggers:** Using the `paths` keyword ensures that workflows run only when the relevant application files or workflow configuration changes, avoiding unnecessary builds and deployments.

## Navigation & Next Steps

* ⬅️ **Previous Lab**: [Lab 03: Nginx HTTPS with Certbot and DuckDNS](../03-nginx-https/README.md)

* 📦 **Source Application**: [Lab 01: Containerized Next.js App](../01-containerized-nextapp/README.md) - Contains the original multi-stage Dockerfile and the Next.js application source code that this pipeline automatically builds and deploys.

* 🏠 **Home**: [Home Labs Overview](../README.md)