# Second Next.js Web App

This additional Next.js website is used in [**Lab 04: Automated CI/CD Pipeline with GitHub Actions**](../../../04-github-actions-ci-cd-pipeline/README.md) to implement and test multiple CI/CD workflows in the same repository alongside the first Next.js web app.

The second web app runs on port `3001` and uses its own GitHub Actions workflow, GHCR image package, and Docker Compose container. The first web app continues to run on port `3000`, allowing both applications to be built and deployed independently in parallel.

This app exists primarily for the multi-workflow CI/CD learning exercise in Lab 04.
