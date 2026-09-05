#!/bin/bash
# Double-click this file to launch the ACL Rehab Tracker.
#
# Before starting, this reclaims the port. A server left running by an earlier
# session can lose its macOS access to the Desktop folder: it keeps the port
# bound but answers every request with "Operation not permitted", which shows
# up in the browser as "the server unexpectedly dropped the connection". A new
# server then cannot bind the port, so relaunching appears to do nothing.
cd "$(dirname "$0")" || exit 1

PORT=8757
APP="ACL Rehab Tracker"

# --- reclaim the port, but only from a previous copy of this app -------------
for pid in $(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null); do
  case "$(ps -o command= -p "$pid" 2>/dev/null)" in
    *acl-rehab*server.py*|*server.py*)
      echo "Stopping the previous $APP server (pid $pid)…"
      kill "$pid" 2>/dev/null
      ;;
    *)
      echo "Port $PORT is in use by something that is not $APP (pid $pid):"
      ps -o command= -p "$pid"
      echo "Leaving it alone. Close that program, then run this again."
      read -r -p "Press return to close." _
      exit 1
      ;;
  esac
done

for _ in $(seq 1 40); do
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1 || break
  sleep 0.25
done
for pid in $(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null); do
  kill -9 "$pid" 2>/dev/null
done

# --- start -------------------------------------------------------------------
python3 server.py &
SERVER_PID=$!

# --- confirm it is actually serving, not just listening ----------------------
healthy=""
for _ in $(seq 1 40); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:$PORT/")" = "200" ]; then
    healthy=1
    break
  fi
  kill -0 "$SERVER_PID" 2>/dev/null || break
  sleep 0.25
done

if [ -z "$healthy" ]; then
  echo
  echo "❌ $APP did not come up on port $PORT. The error is above."
  echo "   If it says \"Operation not permitted\", macOS is blocking access to"
  echo "   the Desktop folder — grant Terminal access under System Settings →"
  echo "   Privacy & Security → Files and Folders (or Full Disk Access)."
  echo
fi

# Keeping the server in the foreground means closing this window stops it,
# instead of leaving an orphan holding the port.
wait "$SERVER_PID"
