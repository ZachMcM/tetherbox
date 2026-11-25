---
name: browser
description: Inspect JavaScript-rendered web pages, take screenshots, and interact with web apps using a headless browser CLI.
---

# browser

Use `agent-browser` when `web_fetch` is not enough, such as for client-rendered SPAs, interactive dashboards, multi-step forms, or capturing screenshots.

## Discovering commands

Run `agent-browser --help` for the exact commands and flags on the installed version. Typical flow:

```sh
agent-browser open "https://example.com"
agent-browser snapshot -i
agent-browser click @e1
agent-browser fill @e2 "query"
agent-browser screenshot /tmp/page.png
agent-browser close
```

## Sharing screenshots

After capturing a screenshot, upload it to the Slack thread with `send_file` instead of describing visual layout from memory. Always close browser sessions when done so headless Chromium processes do not linger on the VM.
