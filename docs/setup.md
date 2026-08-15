# Milestone 0 — Codebase Setup Guide

**Status: instructions only — .**
Companion to /docs/implementation-plan.md (§3, Milestone 0). Follow this
top to bottom; the end state is the repo structure in §3 with all four
packages building, CI green, and IntelliJ IDEA understanding every module.

Verified against this machine on 2026-08-13 (see §2 for what's already
installed).

---

## 1. Housekeeping before scaffolding (do this first)

Three things in the current repo will cause confusion later. Fix them
before adding code.





### 1.3 Initialize git, and drop the stale IDEA module

This isn't a git repo yet, and `.idea/` holds a leftover plain-Java module
(`DesktopHost.iml`) that describes a project structure that no longer
applies.

```bash
cd ~/Desktop/RemoteHost
rm -rf .idea .DS_Store        # IDEA project model is rebuilt in §5; .gitignore keeps .DS_Store out
git init -b main
```

Do not commit yet — write `.gitignore` first (§4.1), or `node_modules/`
and `target/` will end up in the first commit.

---

## 2. Prerequisites

### Already installed (verified)

| Tool | Version found | Verdict |
|---|---|---|
| Node | 22.14.0 | Fine — Vite 7 needs ≥ 20.19 or ≥ 22.12 |
| npm | 10.9.2 | Fine |
| JDK | 25.0.1 (Oracle, arm64) + 23.0.2 | Use **25** (LTS) |
| Maven | 3.9.11 | Fine, but the repo uses `./mvnw` |
| Xcode | 26.6, full Xcode selected | Required for ScreenCaptureKit/VideoToolbox SDKs |
| Apple clang | 21.0.0 | Fine, C++20 + Objective-C++ |
| git | 2.50.1 | — |
| Homebrew | 5.0.9 | — |
| macOS | 26.5.2, Apple Silicon | ScreenCaptureKit needs ≥ 12.3 |
| IntelliJ IDEA | **Ultimate** 2025.3.1 | Java + Maven + JS/TS bundled; C/C++ is not (§5.3) |

### To install

```bash
brew install cmake ninja pkg-config openssl@3
```

`cmake` is genuinely missing (nothing else is). `ninja` for fast
incremental builds, `pkg-config` + `openssl@3` for libdatachannel's TLS
backend (§6.2).

### Version deviation from the plan — please confirm

Plan §3/M0 says "Spring Boot 3 + Java 21". Current reality:
`start.spring.io` now defaults to **Spring Boot 4.1.0**, and this machine
has JDK **25** and **23** (no 21). Recommendation: **Boot 4.1.0 + Java 25**
— both current, both LTS-aligned, nothing in this project depends on Boot 3
APIs. The alternative (`brew install openjdk@21` to match the plan
literally) buys nothing. Say the word if you'd rather pin Boot 3.5.x/Java 21
and I'll adjust the plan instead of the setup.

---

## 3. Target repository structure

End state of Milestone 0. Files marked `←` are the ones you actually
hand-write; everything else comes from a generator.

```
RemoteHost/
├── CLAUDE.md                      ← moved from Docs/ (§1.1)
├── README.md                      ← what this is, how to run each package
├── .gitignore                     ←
├── .gitattributes                 ←
├── .editorconfig                  ← shared indent/EOL rules across 3 languages
├── .github/
│   └── workflows/ci.yml           ← one job per package (§7)
│
├── docs/
│   ├── system-design.md
│   ├── implementation-plan.md
│   └── setup.md                   ← this file
│
├── shared/                        # message-schema source of truth
│   ├── README.md                  ← documents the codegen flow
│   └── schemas/                   # empty in M0; first schema lands in M1
│       └── .gitkeep
│
├── web-client/                    # PWA phone client — React + TS + Vite
│   ├── package.json               # scripts: dev lint test test:e2e build
│   ├── vite.config.ts             # + basic-ssl and host:true for phone testing (§6.1)
│   ├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
│   ├── eslint.config.js
│   ├── playwright.config.ts
│   ├── index.html
│   ├── public/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx                # M0: renders a version string, nothing more
│   │   └── vite-env.d.ts
│   ├── tests/                     # Vitest unit tests
│   └── e2e/                       # Playwright specs
│
├── signaling-server/              # Java 25 + Spring Boot 4.1
│   ├── pom.xml                    # + spotless (lint) bound to verify
│   ├── mvnw / mvnw.cmd / .mvn/
│   └── src/
│       ├── main/java/com/remotehost/signaling/
│       │   └── SignalingServerApplication.java
│       ├── main/resources/application.yaml
│       └── test/java/com/remotehost/signaling/
│           └── SignalingServerApplicationTests.java
│
└── desktop-host/                  # C++20 / Objective-C++ native host
    ├── CMakeLists.txt             ←
    ├── CMakePresets.json          ← IDEA/CLion picks these up automatically
    ├── cmake/Dependencies.cmake   ← FetchContent: libdatachannel, Catch2
    ├── include/desktophost/       # public headers for the 4 module seams
    ├── src/
    │   └── main.cpp               # M0: prints version, exits
    └── tests/
        └── smoke_test.cpp
```

Package name `com.remotehost` and the `RemoteHost` repo name are
placeholders until the app is named — renaming is trivial now, annoying
after M3 (it lands in stored credentials and the macOS bundle id).

---

## 4. Root-level setup

### 4.1 `.gitignore`

Cover all three toolchains plus the IDE:

```
# macOS
.DS_Store
# IDE
.idea/
*.iml
# web-client
node_modules/
dist/
playwright-report/
test-results/
*.local
# signaling-server
target/
# desktop-host
build/
cmake-build-*/
# Claude Code local overrides (settings.json is shared, .local.json is not)
.claude/settings.local.json
```

Ignoring `.idea/` wholesale is the low-friction choice: IDEA regenerates
it, and the shared formatting rules live in `.editorconfig` (which IDEA
honours natively) rather than in IDE config. If you later want shared run
configurations, un-ignore just `.idea/runConfigurations/`.

### 4.2 `.editorconfig`

One place where all three languages agree on whitespace, so a Java
formatter and ESLint don't fight over the same PR:

- All files: UTF-8, LF, trim trailing whitespace, final newline.
- `*.{ts,tsx,js,json,yml,yaml,md}`: 2-space indent.
- `*.java`: 4-space indent (google-java-format style is 2 — pick one and
  make Spotless match this file).
- `*.{cpp,mm,h,hpp,cmake}` + `CMakeLists.txt`: 4-space indent.
- `*.md`: don't trim trailing whitespace (it's a line break in Markdown).

