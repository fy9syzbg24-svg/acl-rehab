#!/bin/bash
# Double-click this file to launch the ACL Rehab Tracker.
cd "$(dirname "$0")" || exit 1
exec python3 server.py
