#!/usr/bin/env bash

set -euo pipefail

echo "[1/8] Updating Ubuntu..."
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

echo "[2/8] Removing conflicting packages..."
for package in \
  docker.io \
  docker-doc \
  docker-compose \
  docker-compose-v2 \
  podman-docker \
  containerd \
  runc
do
  sudo apt-get remove -y "$package" 2>/dev/null || true
done

echo "[3/8] Installing required packages..."
sudo apt-get update
sudo apt-get install -y ca-certificates curl

echo "[4/8] Adding Docker signing key..."
sudo install -m 0755 -d /etc/apt/keyrings

sudo curl -fsSL \
  https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc

sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "[5/8] Adding Docker repository..."
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

echo "[6/8] Installing Docker Engine..."
sudo apt-get update

sudo apt-get install -y \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin

echo "[7/8] Enabling Docker service..."
sudo systemctl enable --now docker

echo "[8/8] Adding $USER to the docker group..."
sudo usermod -aG docker "$USER"

echo
echo "Docker installation completed."
echo
sudo docker version
sudo docker compose version
sudo docker run --rm hello-world

echo
echo "Sign out and reconnect through SSH to use Docker without sudo."
echo "After reconnecting, test with:"
echo
echo "  docker version"
echo "  docker compose version"
echo "  docker run --rm hello-world"