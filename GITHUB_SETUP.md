# GitHub Setup Guide

This guide explains how to set up a GitHub repository for the Subtitle Translator Electron app.

## 1. Initialize Git Repository

If you haven't already initialized a Git repository in your project folder, run:

```bash
git init
```

## 2. Create .gitignore File

We've already created a basic `.gitignore` file, but make sure it includes:

```
# Dependencies
node_modules/
.pnp/
.pnp.js

# Build outputs
dist/
release/
build/

# Development files
.vscode/
.idea/
*.log
.DS_Store

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Electron packaging files
out/
```

## 3. Create GitHub Repository

1. Go to [GitHub](https://github.com/)
2. Click on the '+' icon in the top right and select 'New repository'
3. Enter a name for your repository (e.g., 'subtitle-translator')
4. Add a description (optional)
5. Choose if you want the repository to be public or private
6. Do not initialize the repository with any files (since we're pushing an existing repository)
7. Click 'Create repository'

## 4. Connect and Push to GitHub

After creating the repository, GitHub will display commands to connect your local repository. Run these commands in your project directory:

```bash
# Add the remote GitHub repository
git remote add origin https://github.com/yourusername/subtitle-translator.git

# Add your files to staging
git add .

# Commit your changes
git commit -m "Initial commit"

# Push to GitHub
git push -u origin main
```

Note: If your default branch is named 'master' instead of 'main', replace 'main' with 'master' in the last command.

## 5. GitHub Actions (CI/CD) Setup

Create a GitHub Actions workflow for continuous integration:

1. Create a directory `.github/workflows` in your project
2. Create a file named `build.yml` in that directory

Add this content to `build.yml`:

```yaml
name: Build and Test

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
        node-version: [18.x]

    steps:
      - uses: actions/checkout@v3

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Build
        run: bun run build

      - name: Test
        run: bun test
```

## 6. GitHub README Badge

Add a build status badge to your README.md:

```markdown
# Subtitle Translator

[![Build and Test](https://github.com/yourusername/subtitle-translator/actions/workflows/build.yml/badge.svg)](https://github.com/yourusername/subtitle-translator/actions/workflows/build.yml)

An Electron-based desktop application for generating, translating, and editing subtitles for videos.
```

## 7. Branch Protection Rules (Optional)

For better collaboration, you can set up branch protection rules:

1. Go to your repository on GitHub
2. Click on 'Settings' > 'Branches'
3. Click on 'Add rule' next to 'Branch protection rules'
4. Enter 'main' in the 'Branch name pattern'
5. Select options like:
   - Require pull request reviews before merging
   - Require status checks to pass before merging
   - Require branches to be up to date before merging
6. Click 'Create' to save the rule
