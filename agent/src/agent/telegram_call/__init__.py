"""Telegram voice calls answered by the voice agent, for testing.

Telegram bots can't take calls, so a Telegram user account does: __main__.py logs it in and
answers calls from the allowed users, and bridge.py carries each call's audio to and from a
LiveKit room, where the agent answers it like any other call. Production calls belong on a
real phone line or WhatsApp Business calling, not here.
"""
