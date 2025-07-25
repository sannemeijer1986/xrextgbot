#!/bin/bash

echo "Running otc_bot.py. Type 'restart' to reload or 'stop' to quit."
while true; do
    python3 otc_bot.py &
    BOT_PID=$!
    echo "Bot started with PID $BOT_PID"
    read -p "Command (restart/stop): "
    if [ "$REPLY" == "stop" ]; then
        echo "Stopping bot..."
        if ps -p "$BOT_PID" > /dev/null; then
            pkill -SIGTERM -f "python3 otc_bot.py"
            wait "$BOT_PID" 2>/dev/null
        fi
        echo "Bot stopped."
        break
    elif [ "$REPLY" == "restart" ]; then
        echo "Restarting bot..."
        if ps -p "$BOT_PID" > /dev/null; then
            pkill -SIGTERM -f "python3 otc_bot.py"
            wait "$BOT_PID" 2>/dev/null
        fi
        sleep 1
    else
        echo "Unknown command. Type 'restart' or 'stop'."
        if ps -p "$BOT_PID" > /dev/null; then
            pkill -SIGTERM -f "python3 otc_bot.py"
            wait "$BOT_PID" 2>/dev/null
        fi
        sleep 1
    fi
done
