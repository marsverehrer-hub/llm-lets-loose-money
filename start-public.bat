@echo off
rem Same as start-tailnet.bat, but the link also works for friends who are not on your tailnet (Tailscale Funnel).
rem Funnel must be enabled once for this machine in the Tailscale admin console; the command prints the link if not.
rem "tailscale funnel --https=8443 off" makes it private again.
set PUBLIC=1
call "%~dp0start-tailnet.bat"
