#!/bin/bash

# ============================================================
#  Smart Automation Agent — Startup Prompt (Fixed)
#  Handles DISPLAY, DBUS, and timing issues on Linux/GNOME
# ============================================================

# ── Path to your agent folder ───────────────────────────────
AGENT_DIR="$HOME/Desktop/smart-automation-agent (1)/agent-flat"
LOG="$AGENT_DIR/logs/startup-prompt.log"

mkdir -p "$AGENT_DIR/logs"
echo "[$(date)] Startup prompt triggered" >> "$LOG"

# ── Wait for GNOME desktop to fully load ────────────────────
sleep 15

# ── Set up DISPLAY so zenity can show the popup ─────────────
export DISPLAY=:0

# Find and export the DBUS session (required for zenity on GNOME)
if [ -z "$DBUS_SESSION_BUS_ADDRESS" ]; then
  # Try to find it from the running session
  USER_ID=$(id -u)
  
  # Method 1: from dbus machine id
  DBUS_FILE="/run/user/$USER_ID/bus"
  if [ -S "$DBUS_FILE" ]; then
    export DBUS_SESSION_BUS_ADDRESS="unix:path=$DBUS_FILE"
  fi

  # Method 2: search running processes
  if [ -z "$DBUS_SESSION_BUS_ADDRESS" ]; then
    DBUS_PID=$(pgrep -u "$USER" dbus-daemon | head -1)
    if [ -n "$DBUS_PID" ]; then
      DBUS_ADDR=$(grep -z DBUS_SESSION_BUS_ADDRESS /proc/$DBUS_PID/environ 2>/dev/null | tr '\0' '\n' | grep DBUS)
      export $DBUS_ADDR
    fi
  fi
fi

# ── Also set XDG vars ────────────────────────────────────────
export XDG_RUNTIME_DIR="/run/user/$(id -u)"

echo "[$(date)] DISPLAY=$DISPLAY" >> "$LOG"
echo "[$(date)] DBUS=$DBUS_SESSION_BUS_ADDRESS" >> "$LOG"

# ── Install zenity if missing ────────────────────────────────
if ! command -v zenity &> /dev/null; then
  sudo apt-get install -y zenity >> "$LOG" 2>&1
fi

# ── Show the popup ───────────────────────────────────────────
zenity --question \
  --title="Smart Automation Agent" \
  --text="🤖 <b>Automate your Zoho Check-In / Check-Out today?</b>\n\nThe agent will automatically:\n  • Check-In at <b>9:30 AM</b>\n  • Check-Out at <b>6:30 PM</b>\n\nStart the automation agent?" \
  --ok-label="Yes, Start" \
  --cancel-label="No, Skip" \
  --width=400 \
  2>> "$LOG"

RESPONSE=$?
echo "[$(date)] User response: $RESPONSE (0=Yes, 1=No)" >> "$LOG"

# ── Handle YES ───────────────────────────────────────────────
if [ $RESPONSE -eq 0 ]; then

  if command -v pm2 &> /dev/null; then
    PM2_STATUS=$(pm2 list 2>/dev/null | grep "zoho-agent" | grep "online")
    if [ -z "$PM2_STATUS" ]; then
      cd "$AGENT_DIR"
      pm2 start agent.js --name "zoho-agent" >> "$LOG" 2>&1
    else
      pm2 restart zoho-agent >> "$LOG" 2>&1
    fi
  else
    cd "$AGENT_DIR"
    nohup node agent.js --silent >> "$AGENT_DIR/logs/startup.log" 2>&1 &
  fi

  echo "[$(date)] Agent started" >> "$LOG"

  zenity --notification \
    --text="✅ Automation Agent started!\nCheck-in: 9:30 AM | Check-out: 6:30 PM" \
    2>/dev/null &

# ── Handle NO ────────────────────────────────────────────────
else

  if command -v pm2 &> /dev/null; then
    pm2 stop zoho-agent >> "$LOG" 2>&1
  else
    pkill -f "node agent.js" >> "$LOG" 2>&1
  fi

  echo "[$(date)] Agent skipped" >> "$LOG"

  zenity --notification \
    --text="⏸ Automation Agent skipped for today." \
    2>/dev/null &

fi