# Homebrew Formula for iCloser Agent Shell
# 用法:
#   brew tap icloser/agent-shell
#   brew install icloser-agent-shell
#
# 或本地安装:
#   brew install --build-from-source ./homebrew/icloser-agent-shell.rb

class IcloserAgentShell < Formula
  desc "AI engineering execution CLI — understand, modify, verify, report"
  homepage "https://github.com/YOUR_ORG/agent-shell"  # 替换为你的仓库地址
  version "0.1.0"
  license "MIT"

  on_macos do
    url "https://github.com/YOUR_ORG/agent-shell/releases/download/v0.1.0/icloser-agent-shell-0.1.0-portable.tar.gz"
    sha256 "PLACEHOLDER_SHA256"
  end

  on_linux do
    url "https://github.com/YOUR_ORG/agent-shell/releases/download/v0.1.0/icloser-agent-shell-0.1.0-portable.tar.gz"
    sha256 "PLACEHOLDER_SHA256"
  end

  depends_on "node" => ">= 18"

  def install
    # Install all files to libexec
    libexec.install Dir["*"]

    # Create wrapper script
    (bin/"ic").write <<~EOS
      #!/usr/bin/env bash
      export NODE_PATH="#{libexec}/node_modules:$NODE_PATH"
      exec node "#{libexec}/dist/index.js" "$@"
    EOS
    chmod 0755, bin/"ic"

    # Symlink iCloser alias
    bin.install_symlink bin/"ic" => "iCloser"
  end

  test do
    system "#{bin}/ic", "--version"
  end

  def caveats
    <<~EOS
      \e[36m╭─ iCloser Agent Shell ─────────────────────╮\e[0m
      \e[36m│\e[0m  \e[1mic setup\e[0m    配置 AI 服务              \e[36m│\e[0m
      \e[36m│\e[0m  \e[1mic init\e[0m     初始化项目                \e[36m│\e[0m
      \e[36m│\e[0m  \e[1mic\e[0m         启动对话 REPL             \e[36m│\e[0m
      \e[36m│\e[0m  \e[1mic --help\e[0m  查看所有命令              \e[36m│\e[0m
      \e[36m╰──────────────────────────────────────────╯\e[0m
    EOS
  end
end
