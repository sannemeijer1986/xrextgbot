from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import (
    ApplicationBuilder, CommandHandler, CallbackQueryHandler,
    MessageHandler, filters, ContextTypes
)
import logging
import asyncio
import random
import string
import json
import traceback
import time
import os

try:
    from aiohttp import web
except Exception:
    web = None
try:
    import httpx
except Exception:
    httpx = None

# Configure detailed logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.DEBUG
)
logger = logging.getLogger(__name__)

# Bot token: prefer environment variable for deployment; fall back to test token
BOT_TOKEN = (os.getenv("BOT_TOKEN", "").strip() or "8052956286:AAHDCvxEzQej-xvR0TUyLNwf0bzPlgcn3dY")

# Using Redis-backed Vercel API for state

user_state = {}

# Lightweight local sync state server (prototype)
sync_state = {
    'stage': 1,                 # 1..6 matching website states
    'twofa_verified': False,    # becomes True when BOTC158 2FA accepted
    'linking_code': None,       # e.g., NDG341F
    'updated_at': int(time.time())
}

def set_sync_state(stage: int = None, twofa_verified: bool = None, linking_code: str = None):
    try:
        if stage is not None:
            sync_state['stage'] = int(stage)
        if twofa_verified is not None:
            sync_state['twofa_verified'] = bool(twofa_verified)
        if linking_code is not None:
            sync_state['linking_code'] = str(linking_code)
        sync_state['updated_at'] = int(time.time())
    except Exception:
        pass

# Global bot reference for background tasks
bot_for_notifications = None
session_poll_tasks = {}
session_subscriptions = {}

async def push_state(stage: int = None, twofa_verified: bool = None, linking_code: str = None, actor_tg_user_id: int = None, actor_chat_id: int = None, session_id: str = None):
    """Push state to Redis-backed API (Vercel)."""
    if httpx is None:
        logger.warning("httpx not available; cannot push state")
        return False
    payload = {
        "stage": int(stage) if stage is not None else sync_state.get('stage', 1),
        "twofa_verified": bool(twofa_verified) if twofa_verified is not None else sync_state.get('twofa_verified', False),
        "linking_code": linking_code if linking_code is not None else sync_state.get('linking_code', None),
        "updated_at": int(time.time())
    }
    if actor_tg_user_id is not None:
        payload["actor_tg_user_id"] = int(actor_tg_user_id)
    if actor_chat_id is not None:
        payload["actor_chat_id"] = int(actor_chat_id)
    # Try Vercel API first
    base = os.getenv("STATE_BASE_URL", "").strip()
    token = os.getenv("STATE_WRITE_TOKEN", "").strip()
    if base and token:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                url = base.rstrip('/') + "/api/state"
                if session_id:
                    url = url + ("?session=" + session_id)
                resp = await client.put(
                    url,
                    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                    json=payload
                )
                if 200 <= resp.status_code < 300:
                    logger.info(f"Pushed state to Vercel stage={payload['stage']} twofa={payload['twofa_verified']}")
                    # Start per-session poller (so we can detect stage 6 for this visitor)
                    try:
                        if session_id:
                            if session_id not in session_poll_tasks or session_poll_tasks[session_id].done():
                                session_poll_tasks[session_id] = asyncio.create_task(poll_remote_and_sync(session_id=session_id))
                            # Track actor for this session for targeted notifications
                            try:
                                global session_subscriptions
                                if actor_tg_user_id is not None and actor_chat_id is not None:
                                    info = session_subscriptions.get(session_id, {})
                                    info['user_id'] = int(actor_tg_user_id)
                                    info['chat_id'] = int(actor_chat_id)
                                    info['expiry_notified'] = False
                                    session_subscriptions[session_id] = info
                            except Exception:
                                pass
                    except Exception:
                        pass
                    return True
                else:
                    logger.error(f"Vercel state push failed: {resp.status_code} {resp.text}")
        except Exception as e:
            logger.error(f"Error pushing to Vercel state: {str(e)}")
    # Fallback: even if we couldn't write (missing token/network), still start poller for this session
    try:
        if session_id:
            if session_id not in session_poll_tasks or session_poll_tasks[session_id].done():
                session_poll_tasks[session_id] = asyncio.create_task(poll_remote_and_sync(session_id=session_id))
    except Exception:
        pass
    return False

async def make_sync_app():
    if web is None:
        return None
    app = web.Application()

    @web.middleware
    async def cors_mw(request, handler):
        if request.method == 'OPTIONS':
            resp = web.Response(status=200)
        else:
            resp = await handler(request)
        # Permissive CORS for prototype
        resp.headers['Access-Control-Allow-Origin'] = '*'
        resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        resp.headers['Access-Control-Allow-Headers'] = '*'
        return resp

    app.middlewares.append(cors_mw)

    async def get_state(request):
        return web.json_response(sync_state)

    async def reset_state(request):
        set_sync_state(stage=1, twofa_verified=False, linking_code=None)
        return web.json_response({'ok': True})

    app.add_routes([
        web.route('*', '/xrex/state', get_state),
        web.route('*', '/xrex/reset', reset_state),
    ])
    return app

async def poll_remote_and_sync(session_id: str = None):
    """Background task: poll remote state (Supabase-backed via API) and notify on stage 6."""
    if httpx is None:
        return
    base = os.getenv("STATE_BASE_URL", "").strip() or "https://xrextgbot.vercel.app"
    url_latest = (base.rstrip('/') + "/api/state") + (f"?session={session_id}" if session_id else "")
    last_seen = 0
    poll_until_ts = 0
    prev_stage = None
    while True:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.get(url_latest)
                if r.status_code == 200:
                    record = r.json() or {}
                    ts = int(record.get('updated_at') or 0)
                    if ts > last_seen:
                        last_seen = ts
                        # If website reset to stage 1 or 2, reflect locally
                        stage = int(record.get('stage') or 0)
                        code = record.get('linking_code')
                        twofa = bool(record.get('twofa_verified'))
                        target_user_id = record.get('actor_tg_user_id')
                        target_chat_id = record.get('actor_chat_id')
                        # Start/extend a 5-minute polling window when stage enters 3
                        if stage >= 3:
                            poll_until_ts = int(time.time()) + 5*60
                        if stage <= 2:
                            set_sync_state(stage=stage or 1, twofa_verified=False, linking_code=None)
                            # Reset per-user notification flags so future link/unlink events notify again
                            try:
                                for uid, st in list(user_state.items()):
                                    if st.get('stage6_notified'):
                                        st.pop('stage6_notified', None)
                                    if st.get('stage7_notified'):
                                        st.pop('stage7_notified', None)
                                    user_state[uid] = st
                            except Exception:
                                pass
                        else:
                            set_sync_state(stage=stage, twofa_verified=twofa, linking_code=code)
                        # Detect session expiry transition (>=3 -> <=2)
                        try:
                            if prev_stage is not None and prev_stage >= 3 and stage <= 2:
                                # Target actor from session_subscriptions first
                                notif_user_id = None
                                notif_chat_id = None
                                try:
                                    if session_id:
                                        info = session_subscriptions.get(session_id, {})
                                        if info and not info.get('expiry_notified'):
                                            notif_user_id = info.get('user_id')
                                            notif_chat_id = info.get('chat_id')
                                except Exception:
                                    pass
                                # Fallback: find user by stored session_id
                                if notif_user_id is None or notif_chat_id is None:
                                    try:
                                        for uid, st in list(user_state.items()):
                                            if st.get('session_id') == session_id:
                                                notif_user_id = int(uid)
                                                notif_chat_id = st.get('chat_id')
                                                break
                                    except Exception:
                                        pass
                                if notif_user_id is not None and notif_chat_id is not None:
                                    try:
                                        # Reset bot-side flow so 2FA inputs are ignored
                                        st = user_state.get(notif_user_id, {})
                                        st['awaiting_2fa'] = False
                                        user_state[notif_user_id] = st
                                        if bot_for_notifications:
                                            await bot_for_notifications.send_message(
                                                chat_id=int(notif_chat_id),
                                                text=(
                                                    "⏰ Session expired. Please reopen XREX Pay and start a new linking session "
                                                    "from the app to continue."
                                                )
                                            )
                                        if session_id:
                                            info = session_subscriptions.get(session_id, {})
                                            info['expiry_notified'] = True
                                            session_subscriptions[session_id] = info
                                    except Exception:
                                        pass
                        except Exception:
                            pass
                        prev_stage = stage
                        # If stage 6 reached, send success message; if stage 7 reached, send unlink message
                        if stage >= 6:
                            try:
                                # Iterate known users and notify those who had the BOTC flow
                                for uid, st in list(user_state.items()):
                                    # If remote state indicates a specific actor, only notify that user
                                    if target_user_id is not None:
                                        try:
                                            if int(uid) != int(target_user_id):
                                                continue
                                        except Exception:
                                            pass
                                    chat_id = st.get('chat_id')
                                    if target_chat_id is not None:
                                        try:
                                            chat_id = int(target_chat_id)
                                        except Exception:
                                            pass
                                    if not chat_id:
                                        continue
                                    if stage == 6 and st.get('stage6_notified'):
                                        continue
                                    if stage == 7 and st.get('stage7_notified'):
                                        continue
                                    # Unpin any pinned messages we created
                                    # No unpinning per updated spec
                                    # Send the final success message with buttons
                                    keyboard = [[
                                        InlineKeyboardButton("📚 How to use", callback_data="how_to_use"),
                                        InlineKeyboardButton("...  More", callback_data="more")
                                    ]]
                                    reply_markup = InlineKeyboardMarkup(keyboard)
                                    try:
                                        if bot_for_notifications:
                                            await bot_for_notifications.send_message(
                                                chat_id=chat_id,
                                                text=("✅️ Telegram Bot successfully linked to XREX Pay account @AG***CH\n\n"
                                                     "Tap the ‘How to use’ button to see how the XREX Pay Bot simplifies payments and more.") if stage == 6 else
                                                     ("✅️ Telegram Bot successfully unlinked from XREX Pay account @AG***CH"),
                                                reply_markup=reply_markup
                                            )
                                            if stage == 6:
                                                st['stage6_notified'] = True
                                            else:
                                                st['stage7_notified'] = True
                                            user_state[uid] = st
                                    except Exception:
                                        pass
                                # Fallback: if actor ids provided but not in user_state, send directly once
                                if target_user_id is not None and target_chat_id is not None:
                                    try:
                                        uid = str(target_user_id)
                                        st = user_state.get(uid, {})
                                        already = (stage == 6 and st.get('stage6_notified')) or (stage == 7 and st.get('stage7_notified'))
                                        if not already and bot_for_notifications:
                                            await bot_for_notifications.send_message(
                                                chat_id=int(target_chat_id),
                                                text=("✅️ Telegram Bot successfully linked to XREX Pay account @AG***CH\n\n"
                                                     "Tap the ‘How to use’ button to see how the XREX Pay Bot simplifies payments and more.") if stage == 6 else
                                                     ("✅️ Telegram Bot successfully unlinked from XREX Pay account @AG***CH")
                                            )
                                            if stage == 6:
                                                st['stage6_notified'] = True
                                            else:
                                                st['stage7_notified'] = True
                                            # Ensure chat_id stored for future interactions
                                            st['chat_id'] = int(target_chat_id)
                                            user_state[uid] = st
                                    except Exception:
                                        pass
                            except Exception:
                                pass
        except Exception:
            pass
        # Sleep longer when idle; if within 5-min window, keep 60s; otherwise back off to 5 minutes
        try:
            now_ts = int(time.time())
            if poll_until_ts and now_ts < poll_until_ts:
                base_delay = 1.5   # active window ~10x faster
            else:
                base_delay = 4.5   # idle but still reasonably quick
            # add tiny jitter to avoid sync
            jitter = 0.3
            delay = max(0.5, base_delay + (random.random() - 0.5) * jitter)
        except Exception:
            delay = 4.5
        await asyncio.sleep(delay)

def generate_verification_code():
    """Generate a random 6-digit verification code."""
    return ''.join(random.choices(string.digits, k=6))

async def check_webhook(bot):
    """Check and disable any webhook to ensure polling works."""
    try:
        webhook_info = await bot.get_webhook_info()
        logger.debug(f"Webhook info: {webhook_info}")
        if webhook_info.url:
            logger.warning(f"Webhook found: {webhook_info.url}. Deleting webhook...")
            await bot.delete_webhook(drop_pending_updates=True)
            logger.info("Webhook deleted successfully.")
        else:
            logger.info("No webhook set, polling should work.")
    except Exception as e:
        logger.error(f"Error checking webhook: {str(e)}")

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    logger.debug(f"Entering start for user {update.effective_user.id}")
    user_name = update.effective_user.first_name
    user_id = update.effective_user.id
    chat_id = update.effective_chat.id
    is_group = update.message.chat.type in ['group', 'supergroup']
    # Allow /start always; but if Telegram fires a second plain /start right
    # after a deep-link /start (common on first open), ignore the plain one.
    try:
        current_state = user_state.get(user_id, {})
        now_ts = time.time()
        last_ts = float(current_state.get('last_start_ts', 0))
        last_had_args = bool(current_state.get('last_start_had_args', False))
        no_args_now = not (context.args and len(context.args) > 0)
        if no_args_now and last_had_args and (now_ts - last_ts) < 10:
            logger.debug(f"Suppressing immediate plain /start after deep-link for user {user_id}")
            return
        # record this /start as the latest
        current_state['last_start_ts'] = now_ts
        current_state['last_start_had_args'] = bool(context.args and len(context.args) > 0)
        user_state[user_id] = current_state
    except Exception:
        pass
    
    # Check if this is a deeplink with verification token
    if context.args and len(context.args) > 0:
        verify_token = context.args[0]
        logger.info(f"Deeplink accessed with verify token: {verify_token} by user {user_id}")
        # Extract optional session id suffix: TOKEN_s<SESSION>
        session_id = None
        try:
            parts = str(verify_token).split('_s', 1)
            if len(parts) == 2 and parts[1]:
                candidate = parts[1]
                if len(candidate) <= 64:
                    session_id = candidate
        except Exception:
            session_id = None
        
        # Prototype flow: special handling for BOTC tokens (e.g., BOTC158, BOTC1583)
        token_upper = str(verify_token).upper()
        if token_upper.startswith("BOTC"):
            keyboard = [[
                InlineKeyboardButton("📋 What is 2FA", callback_data="what_is_2fa"),
                InlineKeyboardButton("...  More", callback_data="more")
            ]]
            reply_markup = InlineKeyboardMarkup(keyboard)
            try:
                sent = await update.message.reply_text(
                    "✅️ Valid unique verification link detected from XREX Pay account \"@AG***CH\"\n\n"
                    "Please enter your XREX Pay 2FA to proceed with linking your Telegram account to XREX Pay.",
                    reply_markup=reply_markup
                )
                # No pinning per updated spec
                # Store 2FA awaiting state and the pinned message id
                user_state[user_id] = {
                    'awaiting_2fa': True,
                    'pinned_instruction_message_id': sent.message_id,
                    'linking_code': 'NDG341F',
                    'chat_id': chat_id,
                    'verify_token': verify_token,
                    'session_id': session_id
                }
                # Expose expected next stage to website (prep state 3)
                set_sync_state(stage=3, twofa_verified=False, linking_code='NDG341F')
                try:
                    await push_state(stage=3, twofa_verified=False, linking_code='NDG341F', actor_tg_user_id=user_id, actor_chat_id=chat_id, session_id=session_id)
                except Exception:
                    pass
                logger.info(f"Sent and pinned BOTC linking prompt to user {user_id} for token {verify_token}")
            except Exception as e:
                logger.error(f"Error sending BOTC message to user {user_id}: {str(e)}")
                await update.message.reply_text(f"{user_name}, an error occurred. Please try again.")
            return
        
        # Generate verification code
        verification_code = generate_verification_code()
        
        # Store verification state
        user_state[user_id] = {
            'verify_token': verify_token,
            'verification_code': verification_code,
            'awaiting_verification': True
        }
        
        keyboard = [[InlineKeyboardButton("Generate New Code", callback_data="generate_new_code")]]
        reply_markup = InlineKeyboardMarkup(keyboard)
        
        try:
            await update.message.reply_text(
                f"🔐 **Verification Required**\n\n"
                f"Hi {user_name}! You've accessed this bot via a verification link.\n\n"
                f"**Your verification code is:** `{verification_code}`\n\n"
                f"Please copy this code and paste it into the app that sent you here.\n\n"
                f"Token: `{verify_token}`",
                parse_mode='Markdown',
                reply_markup=reply_markup
            )
            logger.info(f"Sent verification code {verification_code} to user {user_id}")
        except Exception as e:
            logger.error(f"Error sending verification message to user {user_id}: {str(e)}")
            await update.message.reply_text(f"{user_name}, an error occurred during verification. Please try again.")
        
        return
    
    # Normal start flow (no verification token)
    keyboard = [[InlineKeyboardButton("↗️ Go to XREX Pay", url="https://xrextgbot.vercel.app/settings.html?view=content&page=telegram&tab=setup")]]
    reply_markup = InlineKeyboardMarkup(keyboard)
    try:
        await update.message.reply_text(
            "Welcome to the XREX Pay Bot, you haven’t linked your XREX Pay account yet, please visit the XREX Pay Webapp first",
            reply_markup=reply_markup
        )
        logger.info(f"Sent unlinked welcome message for user {user_id}")
    except Exception as e:
        logger.error(f"Error in start for user {user_id}: {str(e)}")
        await update.message.reply_text(f"{user_name}, an error occurred. Please try again.")

async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    user_id = query.from_user.id
    user_name = query.from_user.first_name
    is_group = query.message.chat.type in ['group', 'supergroup']
    logger.debug(f"Received callback query from user {user_id}: {query.data}")

    try:
        await query.answer()
        logger.debug(f"Answered callback query for user {user_id}")
    except Exception as e:
        logger.error(f"Error answering callback query for user {user_id}: {str(e)}")
        return

    state = user_state.get(user_id, {})
    data = query.data

    # Handle verification flow callbacks
    if data == "generate_new_code":
        logger.info(f"Generating new verification code for user {user_id}")
        
        if not state.get('awaiting_verification'):
            await context.bot.send_message(
                chat_id=query.message.chat_id,
                text=f"{user_name}, you are not in verification mode."
            )
            return
            
        # Generate new verification code
        new_verification_code = generate_verification_code()
        state['verification_code'] = new_verification_code
        
        keyboard = [[InlineKeyboardButton("Generate New Code", callback_data="generate_new_code")]]
        reply_markup = InlineKeyboardMarkup(keyboard)
        
        try:
            await context.bot.edit_message_text(
                chat_id=query.message.chat_id,
                message_id=query.message.message_id,
                text=f"🔐 **Verification Required**\n\n"
                     f"Hi {user_name}! You've accessed this bot via a verification link.\n\n"
                     f"**Your verification code is:** `{new_verification_code}`\n\n"
                     f"Please copy this code and paste it into the app that sent you here.\n\n"
                     f"Token: `{state.get('verify_token', 'N/A')}`",
                parse_mode='Markdown',
                reply_markup=reply_markup
            )
            logger.info(f"Generated new verification code {new_verification_code} for user {user_id}")
        except Exception as e:
            logger.error(f"Error updating verification message for user {user_id}: {str(e)}")
        
        return

    # --- Simple handlers for prototype buttons ---
    if data == "what_is_2fa":
        await context.bot.send_message(
            chat_id=query.message.chat_id,
            text=(
                "2FA (Two-Factor Authentication) is a one-time code from your authenticator app "
                "(e.g., Google Authenticator, Authy).\n\n"
                "Open your authenticator app and enter the 6-digit code to continue."
            )
        )
        return

    if data == "more":
        await context.bot.send_message(
            chat_id=query.message.chat_id,
            text=(
                "You can link your Telegram to XREX Pay using a valid link and your 2FA. "
                "This is a prototype flow; more options will appear here later."
            )
        )
        return

    if data == "copy_code":
        # Re-send the linking code with copy-friendly formatting
        code = user_state.get(user_id, {}).get('linking_code', 'NDG341F')
        await context.bot.send_message(
            chat_id=query.message.chat_id,
            text=f"Linking code: `{code}`\n\nTap and hold to copy.",
            parse_mode='Markdown'
        )
        return

    if data == "how_to_use":
        await context.bot.send_message(
            chat_id=query.message.chat_id,
            text=(
                "Here’s how to use the XREX Pay Bot:\n\n"
                "• /check_wallet <address> — See risk and balances for BTC/ETH/TRX addresses\n"
                "• /otc_quote — Request a real-time OTC quote\n"
                "• /otc_orders — Track your OTC orders\n\n"
                "Tip: You can also use the buttons in the web app to open the bot and follow guided flows."
            )
        )
        return

    # Authorization check removed for testing - all users can now use the bot
    # if user_id != 736135332:
    #     await context.bot.send_message(
    #         chat_id=query.message.chat_id,
    #         text=f"{user_name}, you are not authorized to use this bot."
    #     )
    #     logger.info(f"Unauthorized callback attempt by user {user_id} for {data}")
    #     # Reset state to prevent interference
    #     if user_id in user_state:
    #         user_state[user_id] = {}
    #     return

    try:
        if data == "request_quote":
            logger.info(f"Processing request_quote for user {user_id}")
            # Update previous message to show selected action
            previous_message_id = state.get('previous_message_id')
            if previous_message_id:
                try:
                    await context.bot.edit_message_text(
                        chat_id=query.message.chat_id,
                        message_id=previous_message_id,
                        text=f"{user_name}, welcome to XREX Telegram OTC Bot\n"
                             f"This is an OTC agent bot, designed for fast Telegram OTC deals.\n\n"
                             f"{user_name} selected 'request a quote'"
                    )
                except Exception as edit_e:
                    logger.error(f"Error editing message for user {user_id}: {str(edit_e)}")
            keyboard = [
                [InlineKeyboardButton("I want USD, I have USDT", callback_data="usd_usdt")],
                [InlineKeyboardButton("I want USDT, I have USD", callback_data="usdt_usd")]
            ]
            reply_markup = InlineKeyboardMarkup(keyboard)
            sent_message = await context.bot.send_message(
                chat_id=query.message.chat_id,
                text=f"{user_name}, what do you need/have?",
                reply_markup=reply_markup
            )
            state['previous_message_id'] = sent_message.message_id
            logger.info(f"Sent need/have message for user {user_id}")

        elif data == "test_quote":
            logger.info(f"Processing test_quote for user {user_id}")
            
            # Get username from query
            user_username = query.from_user.username
            
            # Create user display name (with username if available)
            user_display = f"{user_name}"
            if user_username:
                user_display += f" (@{user_username})"
                
            # Create the simple order message
            if is_group:
                order_header = "📢 **NEW OTC ORDER REQUEST (TEST)**"
                context_text = f"Group: {update.effective_chat.title or 'Group Chat'}"
            else:
                order_header = "🚀 **OTC ORDER REQUEST (TEST)**"
                context_text = "Private Chat"
            
            # Create a basic order message
            order_message = (
                f"{order_header}\n\n"
                f"👤 **Trader:** {user_display}\n"
                f"📱 **User ID:** `{user_id}`\n"
                f"🏢 **Context:** {context_text}\n"
                f"⏰ **Time:** {query.message.date.strftime('%H:%M:%S UTC')}\n\n"
                f"🔄 **Processing Test Quote Request...**\n"
                f"Expected waiting time: 1–2 minutes\n\n"
                f"*Test order submitted via callback button*"
            )
            
            logger.info(f"Sending test order message to chat {query.message.chat_id}")
            
            # Send the public order message
            await context.bot.send_message(
                chat_id=query.message.chat_id,
                text=order_message,
                parse_mode='Markdown'
            )
            
            logger.info(f"Test order message sent successfully")
            
            # Also send a brief confirmation
            await context.bot.send_message(
                chat_id=query.message.chat_id,
                text=f"✅ {user_name}, your test quote request has been processed!"
            )
            
            logger.info(f"Processed test quote request for user {user_id}")

        elif data in ("usd_usdt", "usdt_usd"):
            logger.info(f"Processing {data} for user {user_id}")
            state['direction'] = "usd_usdt" if data == "usd_usdt" else "usdt_usd"
            previous_message_id = state.get('previous_message_id')
            if previous_message_id:
                await context.bot.edit_message_text(
                    chat_id=query.message.chat_id,
                    message_id=previous_message_id,
                    text=f"{user_name}, what do you need/have?\n\n"
                         f"{user_name} selected 'I want {'USD' if data == 'usd_usdt' else 'USDT'}, I have {'USDT' if data == 'usd_usdt' else 'USD'}'"
                )
            if data == "usd_usdt":
                keyboard = [
                    [InlineKeyboardButton("USDT amount to spend", callback_data="set_usdt")],
                    [InlineKeyboardButton("USD amount to receive", callback_data="set_usd")]
                ]
            else:  # usdt_usd
                keyboard = [
                    [InlineKeyboardButton("USD amount to spend", callback_data="set_usdt")],
                    [InlineKeyboardButton("USDT amount to receive", callback_data="set_usd")]
                ]
            reply_markup = InlineKeyboardMarkup(keyboard)
            sent_message = await context.bot.send_message(
                chat_id=query.message.chat_id,
                text=f"Ok, you want {'USD' if data == 'usd_usdt' else 'USDT'}, you have {'USDT' if data == 'usd_usdt' else 'USD'}.\n"
                     f"{user_name}, how would you like to express the amount?",
                reply_markup=reply_markup
            )
            state['previous_message_id'] = sent_message.message_id
            logger.info(f"Sent amount selection message for user {user_id}")

        elif data in ("set_usdt", "set_usd"):
            logger.info(f"Processing {data} for user {user_id}")
            state['mode'] = data

            # Store the exact text that was selected and determine amount type
            if data == 'set_usdt':
                if state['direction'] == 'usd_usdt':
                    selected_text = "USDT amount to spend"
                    amount_type = "USDT"
                    state['action'] = 'spend'
                else:  # usdt_usd
                    selected_text = "USD amount to spend"
                    amount_type = "USD"
                    state['action'] = 'spend'
            else:  # set_usd
                if state['direction'] == 'usd_usdt':
                    selected_text = "USD amount to receive"
                    amount_type = "USD"
                    state['action'] = 'receive'
                else:  # usdt_usd
                    selected_text = "USDT amount to receive"
                    amount_type = "USDT"
                    state['action'] = 'receive'
            
            # Store the amount_type for later use
            state['amount_type'] = amount_type

            # Update the previous message to remove buttons and add summary
            previous_message_id = state.get('previous_message_id')
            if previous_message_id:
                try:
                    await context.bot.edit_message_text(
                        chat_id=query.message.chat_id,
                        message_id=previous_message_id,
                        text=f"Ok, you want {'USD' if state['direction'] == 'usd_usdt' else 'USDT'}, you have {'USDT' if state['direction'] == 'usd_usdt' else 'USD'}.\n"
                             f"{user_name}, how would you like to express the amount?\n\n"
                             f"{user_name} selected '{selected_text}'"
                    )
                except Exception as edit_e:
                    logger.error(f"Error editing message for user {user_id}: {str(edit_e)}")
                    state['previous_message_id'] = None  # Reset on failure to avoid future errors
            # Send the next step without additional summary
            reply_markup = None
            sent_message = await context.bot.send_message(
                chat_id=query.message.chat_id,
                text=f"{user_name}, please key in the amount of {amount_type} you'd like to {state['action']} in this OTC deal."
            )
            state['previous_message_id'] = sent_message.message_id
            state['awaiting_amount'] = True
            logger.info(f"Requested amount input for user {user_id}")

        elif data == "confirm":
            logger.info(f"Processing confirm for user {user_id}")
            previous_message_id = state.get('previous_message_id')
            if previous_message_id:
                formatted_amount = "{:,.2f}".format(float(state.get('amount', 0)))
                action = state.get('action', 'receive')
                direction_text = "USD, you have USDT" if state.get('direction') == "usd_usdt" else "USDT, you have USD"
                await context.bot.edit_message_text(
                    chat_id=query.message.chat_id,
                    message_id=previous_message_id,
                    text=f"Ok, you want {direction_text}. You entered {formatted_amount} to {action}. Is this correct?\n\n"
                         f"{user_name} selected 'Yes, Request quote'"
                )
            amount = state.get('amount', '???')
            reply_markup = None
            await context.bot.send_message(
                chat_id=query.message.chat_id,
                text=f"{user_name}, your RFQ order is being processed,\nExpected waiting time: 1–2 minutes"
            )
            # Do not clear user_state here to keep chatlog
            logger.info(f"Processed RFQ for user {user_id}")

        elif data == "back":
            logger.info(f"Processing back for user {user_id}")
            previous_message_id = state.get('previous_message_id')
            if previous_message_id:
                formatted_amount = "{:,.2f}".format(float(state.get('amount', 0)))
                action = state.get('action', 'receive')
                direction_text = "USD, you have USDT" if state.get('direction') == "usd_usdt" else "USDT, you have USD"
                await context.bot.edit_message_text(
                    chat_id=query.message.chat_id,
                    message_id=previous_message_id,
                    text=f"Ok, you want {direction_text}. You entered {formatted_amount} to {action}. Is this correct?\n\n"
                         f"{user_name} selected 'No, Restart'"
                )
            
            # Check if user is in verification mode - don't restart if they are
            if state.get('awaiting_verification'):
                verify_token = state.get('verify_token', 'N/A')
                verification_code = state.get('verification_code', 'N/A')
                
                keyboard = [[InlineKeyboardButton("Generate New Code", callback_data="generate_new_code")]]
                reply_markup = InlineKeyboardMarkup(keyboard)
                
                await context.bot.send_message(
                    chat_id=query.message.chat_id,
                    text=f"🔐 **Verification Mode Active**\n\n"
                         f"Hi {user_name}! You're in verification mode.\n\n"
                         f"**Your verification code is:** `{verification_code}`\n\n"
                         f"Please copy this code and paste it into the app that sent you here.\n\n"
                         f"Token: `{verify_token}`",
                    parse_mode='Markdown',
                    reply_markup=reply_markup
                )
                logger.info(f"Returned to verification mode for user {user_id}")
            else:
                # Normal OTC flow restart
                keyboard = [[InlineKeyboardButton("request a quote", callback_data="request_quote")]]
                reply_markup = InlineKeyboardMarkup(keyboard)
                
                await context.bot.send_message(
                    chat_id=query.message.chat_id,
                    text=f"{user_name}, welcome to XREX Telegram OTC Bot\n"
                         f"This is an OTC agent bot, designed for fast Telegram OTC deals.\n\n"
                         f"Your Telegram User ID: {user_id}\n"
                         f"This Chat ID: {query.message.chat_id}",
                    reply_markup=reply_markup
                )
                # Reset state for normal flow but keep user_id
                user_state[user_id] = {'initiator_id': user_id}
                logger.info(f"Restarted OTC flow for user {user_id}")
            
            # Do not clear user_state here to keep chatlog
            logger.info(f"Returned to start for user {user_id}")

        elif data == "quit":
            logger.info(f"Processing quit for user {user_id}")
            previous_message_id = state.get('previous_message_id')
            if previous_message_id:
                formatted_amount = "{:,.2f}".format(float(state.get('amount', 0)))
                action = state.get('action', 'receive')
                direction_text = "USD, you have USDT" if state.get('direction') == "usd_usdt" else "USDT, you have USD"
                await context.bot.edit_message_text(
                    chat_id=query.message.chat_id,
                    message_id=previous_message_id,
                    text=f"Ok, you want {direction_text}. You entered {formatted_amount} to {action}. Is this correct?\n\n"
                         f"{user_name} selected 'Quit'"
                )
            user_state.pop(user_id, None)  # Clear user state
            await context.bot.send_message(
                chat_id=query.message.chat_id,
                text=f"{user_name}, you have quit the OTC deal flow."
            )
            logger.info(f"Quit processed for user {user_id}")

    except Exception as e:
        logger.error(f"Error in handle_callback for user {user_id}: {str(e)}")
        try:
            await context.bot.send_message(
                chat_id=query.message.chat_id,
                text=f"{user_name}, an error occurred. Please try again."
            )
            logger.info(f"Sent error message to user {user_id}")
        except Exception as reply_e:
            logger.error(f"Failed to send error message to user {user_id}: {str(reply_e)}")

# --- Web App Data Handler ---
async def handle_web_app_data(update: Update, context: ContextTypes.DEFAULT_TYPE):
    logger.info("WEB APP DATA HANDLER TRIGGERED")
    if update.message and update.message.web_app_data:
        data = update.message.web_app_data.data
        logger.info(f"Received web app data: {data}")
        
        try:
            # Parse the JSON data from the mini app
            quote_data = json.loads(data)
            user_name = update.effective_user.first_name
            user_username = update.effective_user.username
            user_id = update.effective_user.id
            is_group = update.message.chat.type in ['group', 'supergroup']
            
            # Create user display name (with username if available)
            user_display = f"{user_name}"
            if user_username:
                user_display += f" (@{user_username})"
            
            # Extract quote information
            have_currency = quote_data['have']['currency']
            have_amount = quote_data['have']['amount']
            want_currency = quote_data['want']['currency']
            want_amount = quote_data['want']['amount']
            
            # Create formatted amounts
            have_amount_str = f"{have_amount:,.2f}" if have_amount else "Market Rate"
            want_amount_str = f"{want_amount:,.2f}" if want_amount else "Market Rate"
            
            # Create the order message
            if is_group:
                order_header = "📢 **NEW OTC ORDER REQUEST**"
                context_text = f"Group: {update.effective_chat.title or 'Group Chat'}"
            else:
                order_header = "🚀 **OTC ORDER REQUEST**"
                context_text = "Private Chat"
            
            order_message = (
                f"{order_header}\n\n"
                f"👤 **Trader:** {user_display}\n"
                f"📱 **User ID:** `{user_id}`\n"
                f"🏢 **Context:** {context_text}\n"
                f"⏰ **Time:** {update.message.date.strftime('%H:%M:%S UTC')}\n\n"
                f"💰 **I have:** {have_amount_str} {have_currency}\n"
                f"🎯 **I want:** {want_amount_str} {want_currency}\n\n"
                f"🔄 **Processing quote request...**\n"
                f"Expected waiting time: 1–2 minutes\n\n"
                f"*Order submitted via Mini App*"
            )
            
            logger.info(f"Sending OTC order message to chat {update.message.chat_id}")
            
            # Send the public order message
            await update.message.reply_text(
                order_message,
                parse_mode='Markdown'
            )
            
            # Send confirmation to user
            await context.bot.send_message(
                chat_id=update.message.chat_id,
                text=f"✅ {user_name}, your OTC quote request has been submitted!\n"
                     f"📊 **Summary:** {have_amount_str} {have_currency} → {want_amount_str} {want_currency}"
            )
            
            logger.info(f"Processed OTC quote request from mini app for user {user_id}")
            
        except json.JSONDecodeError:
            # Handle legacy format or simple text data
            logger.info(f"Received simple web app data (not JSON): {data}")
            await update.message.reply_text("✅ Quote request received: " + str(data))
        except Exception as e:
            logger.error(f"Error processing web app data: {str(e)}")
            await update.message.reply_text("❌ Error processing your quote request. Please try again.")
    else:
        logger.info("No web app data found in message.")

async def test_webapp(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Test web app functionality"""
    user_name = update.effective_user.first_name
    
    # Create a simple message with web app button
    keyboard = [[InlineKeyboardButton("🧪 Test Web App", web_app=WebAppInfo(url="https://sannemeijer1986.github.io/xrextgbot/miniapp.html"))]]
    reply_markup = InlineKeyboardMarkup(keyboard)
    
    try:
        await update.message.reply_text(
            f"🧪 **Web App Test**\n\n"
            f"Hi {user_name}! Click the button below to test the web app.\n\n"
            f"If this works, the issue might be with the domain configuration in BotFather.",
            parse_mode='Markdown',
            reply_markup=reply_markup
        )
        logger.info(f"Sent test web app message for user {update.effective_user.id}")
    except Exception as e:
        logger.error(f"Error in test_webapp for user {update.effective_user.id}: {str(e)}")
        await update.message.reply_text(f"{user_name}, an error occurred during the test.")


async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.message.from_user.id
    user_name = update.message.from_user.first_name
    is_group = update.message.chat.type in ['group', 'supergroup']
    state = user_state.get(user_id, {})
    logger.debug(f"Received text from user {user_id}: {update.message.text}")

    try:
        # Check if user is in verification mode and handle verification commands
        if state.get('awaiting_verification'):
            text = update.message.text.strip()
            
            # Handle verification status check
            if text.lower() in ['/status', 'status']:
                verify_token = state.get('verify_token', 'N/A')
                verification_code = state.get('verification_code', 'N/A')
                
                await update.message.reply_text(
                    f"🔐 **Verification Status**\n\n"
                    f"Token: `{verify_token}`\n"
                    f"Current Code: `{verification_code}`\n\n"
                    f"Type `/newcode` to generate a new verification code.",
                    parse_mode='Markdown'
                )
                return
            
            # Handle new code generation
            if text.lower() in ['/newcode', 'newcode']:
                new_verification_code = generate_verification_code()
                state['verification_code'] = new_verification_code
                
                await update.message.reply_text(
                    f"🔐 **New Verification Code Generated**\n\n"
                    f"**Your new verification code is:** `{new_verification_code}`\n\n"
                    f"Please copy this code and paste it into the app that sent you here.",
                    parse_mode='Markdown'
                )
                logger.info(f"Generated new verification code {new_verification_code} for user {user_id}")
                return
            
            # For any other text while in verification mode, show the current code
            verify_token = state.get('verify_token', 'N/A')
            verification_code = state.get('verification_code', 'N/A')
            
            await update.message.reply_text(
                f"🔐 **Verification Mode Active**\n\n"
                f"**Your verification code is:** `{verification_code}`\n\n"
                f"Commands:\n"
                f"• `/status` - Show verification status\n"
                f"• `/newcode` - Generate new code\n\n"
                f"Please copy the code and paste it into the app that sent you here.",
                parse_mode='Markdown'
            )
            return
        
        # 2FA prototype flow (BOTC158): any integer entered is treated as valid code
        if state.get('awaiting_2fa'):
            text = update.message.text.strip()
            if text.isdigit() and len(text) >= 1:
                # Unpin the instruction message if pinned
                pinned_id = state.get('pinned_instruction_message_id')
                # No unpinning per updated spec

                await update.message.reply_text("✅️ 2FA verified! \n\nGenerating linking code... ")
                await asyncio.sleep(1)

                # Generate a dynamic linking code per session/user
                try:
                    sid = None
                    try:
                        last_token = user_state.get(user_id, {}).get('verify_token') or verify_token
                        if last_token and '_s' in last_token:
                            sid = last_token.split('_s',1)[1]
                    except Exception:
                        pass
                    # Simple deterministic code per session/user for demo
                    base = (sid or '') + ':' + str(user_id)
                    import hashlib
                    code_hash = hashlib.sha1(base.encode('utf-8')).hexdigest().upper()
                    linking_code = code_hash[:6]
                except Exception:
                    linking_code = state.get('linking_code', 'NDG341F')
                await update.message.reply_text(linking_code)

                # Final instruction with buttons and pin
                keyboard = [[
                    InlineKeyboardButton("↗️ Go to XREX Pay", url="https://xrextgbot.vercel.app/"),
                    InlineKeyboardButton("📋 Copy code", callback_data="copy_code")
                ], [
                    InlineKeyboardButton("...  More", callback_data="more")
                ]]
                reply_markup = InlineKeyboardMarkup(keyboard)
                final_msg = await update.message.reply_text(
                    "Please copy the linking code, go to XREX Pay, and enter it there. (Valid for 5 minutes)",
                    reply_markup=reply_markup
                )
                # No pinning per updated spec

                # Update state to stop awaiting 2FA
                state['awaiting_2fa'] = False
                state['final_pinned_message_id'] = final_msg.message_id
                user_state[user_id] = state
                # Update local sync server and remote state so website can advance to state 4
                set_sync_state(stage=4, twofa_verified=True, linking_code=linking_code)
                try:
                    # Reuse session id from user's last deeplink if available
                    sess = None
                    try:
                        last_token = user_state.get(user_id, {}).get('verify_token')
                        if last_token and '_s' in last_token:
                            sess = last_token.split('_s',1)[1]
                    except Exception:
                        pass
                    await push_state(stage=4, twofa_verified=True, linking_code=linking_code, actor_tg_user_id=user_id, actor_chat_id=update.message.chat_id, session_id=sess)
                except Exception:
                    pass
                return
            else:
                # Gentle reminder only (do not unpin original instruction)
                await update.message.reply_text(
                    "❌ The 2FA code you entered is incorrect or expired. Please try again with a valid code."
                )
                return

        # Normal OTC flow handling
        if not state or not state.get("awaiting_amount"):
            logger.debug(f"No awaiting amount for user {user_id}, ignoring text")
            return

        state["amount"] = update.message.text
        state["awaiting_amount"] = False
        logger.info(f"Stored amount {state['amount']} for user {user_id}")

        direction_text = "USD, you have USDT" if state['direction'] == "usd_usdt" else "USDT, you have USD"
        amount = float(state["amount"])  # Convert to float to handle decimals
        formatted_amount = "{:,.2f}".format(amount)  # Format with commas and 2 decimal places
        action = state.get('action', 'receive')  # Default to 'receive' if not set

        # Update the previous message to show the amount entered
        previous_message_id = state.get('previous_message_id')
        if previous_message_id:
            try:
                # Use the stored amount_type
                amount_type = state.get('amount_type', 'USD')
                await context.bot.edit_message_text(
                    chat_id=update.message.chat_id,
                    message_id=previous_message_id,
                    text=f"{user_name}, please key in the amount of {amount_type} you'd like to {action} in this OTC deal.\n\n"
                         f"{user_name} entered {formatted_amount}"
                )
            except Exception as edit_e:
                logger.error(f"Error editing message for user {user_id}: {str(edit_e)}")

        keyboard = [
            [InlineKeyboardButton("Yes, Request quote", callback_data="confirm")],
            [InlineKeyboardButton("No, Restart", callback_data="back")],
            [InlineKeyboardButton("Quit", callback_data="quit")]
        ]
        reply_markup = InlineKeyboardMarkup(keyboard)
        sent_message = await update.message.reply_text(
            f"Ok, you want {direction_text}. You entered {formatted_amount} to {action}. Is this correct?",
            reply_markup=reply_markup
        )
        state['previous_message_id'] = sent_message.message_id
        logger.info(f"Sent confirmation message for user {user_id}")
    except ValueError:
        # Handle non-numeric input
        await update.message.reply_text(f"{user_name}, please enter a valid number.")
        logger.error(f"Invalid amount entered by user {user_id}")
    except Exception as e:
        logger.error(f"Error in handle_text for user {user_id}: {str(e)}")
        await update.message.reply_text(f"{user_name}, an error occurred. Please try again.")

async def main():
    application = None
    runner = None
    try:
        logger.info("Starting bot...")
        application = ApplicationBuilder().token(BOT_TOKEN).build()
        await application.initialize()
        await check_webhook(application.bot)
        # Set global bot reference
        global bot_for_notifications
        bot_for_notifications = application.bot

        # Start local sync HTTP server (127.0.0.1:8787) if aiohttp is available
        try:
            app = await make_sync_app()
            if app is not None:
                runner = web.AppRunner(app)
                await runner.setup()
                site = web.TCPSite(runner, '127.0.0.1', 8787)
                await site.start()
                logger.info("Local sync server running at http://127.0.0.1:8787/xrex/state")
            else:
                logger.warning("aiohttp not installed; local sync server disabled")
        except Exception as e:
            logger.error(f"Failed to start local sync server: {str(e)}")
        
        # Register handlers in correct order: web app data first, then others, debug last
        application.add_handler(MessageHandler(filters.StatusUpdate.WEB_APP_DATA, handle_web_app_data), group=0)
        application.add_handler(CommandHandler("start", start), group=1)
        application.add_handler(CallbackQueryHandler(handle_callback), group=2)
        application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text), group=3)
        
        # Add debug handler to catch ALL messages for logging only
        async def debug_all_updates(update: Update, context: ContextTypes.DEFAULT_TYPE):
            logger.info(f"=== DEBUG: Received update type: {type(update.message).__name__ if update.message else 'No message'}")
            if update.message:
                logger.info(f"=== DEBUG: Message content_type: {getattr(update.message, 'content_type', 'Unknown')}")
                logger.info(f"=== DEBUG: Message text: {getattr(update.message, 'text', 'No text')}")
                logger.info(f"=== DEBUG: Has web_app_data: {hasattr(update.message, 'web_app_data') and update.message.web_app_data}")
                if hasattr(update.message, 'web_app_data') and update.message.web_app_data:
                    logger.info(f"=== DEBUG: Web app data: {update.message.web_app_data.data}")

        application.add_handler(MessageHandler(filters.ALL, debug_all_updates), group=4)

        logger.info("Bot handlers registered, starting polling...")
        await application.start()  # Start the application explicitly
        # Optionally start polling remote state for a demo session if provided via env
        try:
            demo_session = os.getenv('DEMO_SESSION_ID', '').strip() or None
            if demo_session:
                asyncio.create_task(poll_remote_and_sync(session_id=demo_session))
        except Exception:
            pass
        await application.updater.start_polling(
            allowed_updates=["message", "callback_query"],
            drop_pending_updates=True
        )
        # Keep the application running
        await asyncio.Event().wait()  # Wait indefinitely
    except Exception as e:
        logger.error(f"Error starting bot: {str(e)}")
        raise
    finally:
        if application:
            logger.info("Shutting down application...")
            try:
                await application.updater.stop()
                await application.stop()
                await application.shutdown()
                logger.info("Application shut down successfully.")
            except Exception as shutdown_e:
                logger.error(f"Error during shutdown: {str(shutdown_e)}")
        if runner:
            try:
                await runner.cleanup()
            except Exception:
                pass

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Bot stopped by user (KeyboardInterrupt).")
    except Exception as e:
        logger.error(f"Error in asyncio.run: {str(e)}")