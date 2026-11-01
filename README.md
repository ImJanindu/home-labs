# 🧪 Home Labs

A hands-on engineering log and collection of personal homelab experiments covering **Linux administration, Docker, cloud-native deployments, CI/CD automation, and modern infrastructure engineering**.

---

## 🎯 Purpose & Philosophy

This repository documents practical, reproducible, and production-inspired infrastructure experiments. Instead of superficial tutorials, each lab focuses on understanding underlying system architectures, optimizing performance (such as Docker layer caching and image footprint), and solving real-world deployment challenges.

Every lab is organized into its own self-contained directory containing:
- Application source code and configuration files.
- Automated provisioning and bootstrap scripts.
- A dedicated, detailed `README.md` with step-by-step documentation, architecture diagrams, and commands reference.

---

## 📂 Homelab Index & Directory

| # | Lab | Core Technologies | Description | Status |
| :---: | :--- | :--- | :--- | :---: |
| **01** | [**Containerized Next.js App**](./01-containerized-nextapp/) | `Docker`, `Bun`, `Next.js`, `AWS EC2`, `Ubuntu`, `Bash` | Deep dive into Docker architecture, multi-stage caching with Bun & Next.js standalone output, automated host provisioning with `install-docker.sh`, and deploying to an AWS EC2 Ubuntu instance. | Completed |
| **02** | **Nginx Reverse Proxy for Next.js on EC2** | `Nginx`, `Docker`, `AWS EC2`, `Ubuntu`, `Reverse Proxy` | Setting up Nginx alongside the containerized Next.js app on AWS EC2 to act as a reverse proxy, handling standard HTTP/HTTPS traffic routing, port forwarding, and proxy headers. | Up Next |

---

## 🧭 Repository Structure

```text
home-labs/
├── LICENSE                      # MIT License
├── README.md                    # Root index & homelab roadmap (you are here)
└── 01-containerized-nextapp/    # Lab 01: Dockerized Next.js on AWS EC2
    ├── .dockerignore            # Docker build context exclusions
    ├── Dockerfile               # Multi-stage Bun + Next.js build
    ├── README.md                # In-depth Lab 01 documentation & guide
    ├── app/                     # Homelab status dashboard web app
    ├── install-docker.sh        # Automated Docker Engine setup script for Ubuntu
    ├── next.config.ts           # Next.js standalone build configuration
    └── package.json             # App dependencies & scripts
```

---

## 🛠️ Core Technologies & Tooling

- **Operating Systems**: Ubuntu Linux (Server LTS), Debian
- **Containers & Runtimes**: Docker Engine, Docker Buildx, Bun, Node.js
- **Web Servers & Proxies**: Nginx
- **Cloud & Infrastructure**: AWS (EC2, VPC, Security Groups)
- **Frameworks & Languages**: Next.js (App Router), TypeScript, React, Bash / Shell scripting
- **Automation & DevOps**: Git, GitHub Actions, systemd

---

## 👨‍💻 About the Developer

**Janindu Malshan**  
*Software Engineer & DevOps / Cloud Enthusiast*

- 🌐 **GitHub**: [@ImJanindu](https://github.com/ImJanindu)
- 📧 **Email**: [janindumalshan123@gmail.com](mailto:janindumalshan123@gmail.com)
- 📁 **Repository**: [ImJanindu/home-labs](https://github.com/ImJanindu/home-labs)

Feel free to explore the lab folders, inspect the scripts, or star the repo if you find the notes helpful!

---

## 📄 License

This repository is licensed under the [MIT License](./LICENSE).
