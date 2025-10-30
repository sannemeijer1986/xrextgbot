from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo, BotCommand, BotCommandScopeChat
from telegram.ext import (
    ApplicationBuilder, CommandHandler, CallbackQueryHandler,
    MessageHandler, filters, ContextTypes
)
import logging
from io import BytesIO
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
finalize_watch_tasks = {}
notify_locks = {}

async def begin_stage6_notify(user_id: int) -> bool:
    try:
        uid = int(user_id)
        lock = notify_locks.get(uid)
        if lock is None:
            lock = asyncio.Lock()
            notify_locks[uid] = lock
        if lock.locked():
            return False
        await lock.acquire()
        st = user_state.get(uid, {})
        if st.get('stage6_notified') or st.get('stage6_inflight'):
            try:
                lock.release()
            except Exception:
                pass
            return False
        st['stage6_inflight'] = True
        user_state[uid] = st
        return True
    except Exception:
        return False

async def end_stage6_notify(user_id: int, success: bool):
    try:
        uid = int(user_id)
        st = user_state.get(uid, {})
        st.pop('stage6_inflight', None)
        if success:
            st['stage6_notified'] = True
        user_state[uid] = st
        lock = notify_locks.get(uid)
        if lock and lock.locked():
            try:
                lock.release()
            except Exception:
                pass
    except Exception:
        pass

async def upload_avatar_to_supabase(image_bytes: bytes, ext_hint: str, user_id: int) -> str:
    try:
        base = os.getenv('SUPABASE_URL', '').strip() or os.getenv('NEXT_PUBLIC_SUPABASE_URL', '').strip()
        service_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '').strip() or os.getenv('SUPABASE_ANON_KEY', '').strip()
        bucket = os.getenv('SUPABASE_AVATAR_BUCKET', 'tg-avatars').strip()
        if not base or not service_key or httpx is None:
            return ''
        ext = 'jpg'
        try:
            eh = (ext_hint or '').lower()
            if '.png' in eh or eh == 'png':
                ext = 'png'
            elif '.webp' in eh or eh == 'webp':
                ext = 'webp'
            elif '.jpeg' in eh or eh == 'jpeg':
                ext = 'jpeg'
        except Exception:
            pass
        # Transcode unsupported formats (e.g., webp) to jpeg for bucket policy compliance
        try:
            if ext == 'webp':
                try:
                    from PIL import Image
                    bio_in = BytesIO(image_bytes)
                    img = Image.open(bio_in).convert('RGB')
                    bio_out = BytesIO()
                    img.save(bio_out, format='JPEG', quality=88)
                    image_bytes = bio_out.getvalue()
                    ext = 'jpg'
                except Exception:
                    # Fallback: just mark as jpeg; many clients accept it regardless
                    ext = 'jpg'
        except Exception:
            pass
        key = f"tg/{int(user_id)}/{int(time.time())}.{ext}"
        url = base.rstrip('/') + f"/storage/v1/object/{bucket}/{key}"
        headers = {
            'Authorization': f"Bearer {service_key}",
            'apikey': service_key,
            'Content-Type': f"image/{ext if ext != 'jpg' else 'jpeg'}"
        }
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.put(url, headers=headers, content=image_bytes)
            if 200 <= resp.status_code < 300:
                public_url = base.rstrip('/') + f"/storage/v1/object/public/{bucket}/{key}"
                return public_url
            else:
                logger.warning(f"Supabase avatar upload failed: {resp.status_code} {resp.text}")
                return ''
    except Exception as e:
        logger.error(f"upload_avatar_to_supabase error: {str(e)}")
        return ''

async def capture_and_cache_tg_profile(update: Update, context: ContextTypes.DEFAULT_TYPE) -> dict:
    profile = {
        'tg_username': None,
        'tg_display_name': None,
        'tg_photo_url': None
    }
    try:
        user = update.effective_user
        if not user:
            return profile
        uid = int(user.id)
        uname = (user.username or '').strip() or None
        fname = (user.first_name or '').strip()
        lname = (getattr(user, 'last_name', '') or '').strip()
        dname = (f"{fname} {lname}" if lname else fname).strip() or None
        profile['tg_username'] = uname
        profile['tg_display_name'] = dname
        # Try load avatar and upload to Supabase
        try:
            photos = await context.bot.get_user_profile_photos(uid, limit=1)
            file_id = None
            if photos and photos.total_count and photos.photos:
                first = photos.photos[0]
                size = first[-1] if isinstance(first, (list, tuple)) else first
                file_id = getattr(size, 'file_id', None)
            # Fallback to chat photo if profile_photos missing
            if not file_id:
                try:
                    chat = await context.bot.get_chat(uid)
                    if chat and getattr(chat, 'photo', None):
                        file_id = chat.photo.big_file_id or chat.photo.small_file_id
                except Exception:
                    pass
            if file_id:
                tg_file = await context.bot.get_file(file_id)
                bio = BytesIO()
                await tg_file.download_to_memory(out=bio)
                bio.seek(0)
                data = bio.getvalue()
                ext_hint = getattr(tg_file, 'file_path', '') or ''
                public_url = await upload_avatar_to_supabase(data, ext_hint, uid)
                if public_url:
                    profile['tg_photo_url'] = public_url
                    # Profile-only backfill (does not change stage)
                    try:
                        if httpx is not None:
                            base = os.getenv("STATE_BASE_URL", "").strip() or "https://xrextgbot.vercel.app"
                            token = os.getenv("STATE_WRITE_TOKEN", "").strip()
                            if token:
                                # Prefer user's last known session id
                                sess = user_state.get(uid, {}).get('session_id')
                                if not sess:
                                    try:
                                        _, sess = await is_linked_for_user(uid)
                                    except Exception:
                                        sess = None
                                if sess:
                                    url = base.rstrip('/') + f"/api/state?session={sess}"
                                    body = {"tg_username": uname, "tg_display_name": dname, "tg_photo_url": public_url}
                                    async with httpx.AsyncClient(timeout=10.0) as client:
                                        await client.put(
                                            url,
                                            headers={
                                                "Content-Type": "application/json",
                                                "Authorization": f"Bearer {token}",
                                                "X-Profile-Only": "1"
                                            },
                                            json=body
                                        )
                    except Exception as ee:
                        logger.debug(f"Avatar profile-only PUT failed for user {uid}: {str(ee)}")
        except Exception as e:
            logger.warning(f"Avatar capture failed for user {uid}: {str(e)}")
        # Cache into user_state
        st = user_state.get(uid, {})
        st['tg_username'] = profile['tg_username']
        st['tg_display_name'] = profile['tg_display_name']
        st['tg_photo_url'] = profile['tg_photo_url']
        user_state[uid] = st
        return profile
    except Exception:
        return profile

def xrex_link_url():
    try:
        return "https://xrextgbot.vercel.app/settings.html?view=content&page=telegram&tab=setup"
    except Exception:
        return "https://xrextgbot.vercel.app/"

async def guard_midflow_and_remind(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    """Return True if a mid-flow reminder was sent and the caller should stop."""
    try:
        user_id = update.effective_user.id if update and update.effective_user else None
        st = user_state.get(user_id, {}) if user_id else {}
        if st.get('awaiting_verification'):
            keyboard = [[InlineKeyboardButton("Generate New Code", callback_data="generate_new_code")]]
            await update.message.reply_text(
                f"🔐 Verification in progress\n\nYour verification code is: `{st.get('verification_code','N/A')}`\nCopy this into the XREX Pay web app.",
                parse_mode='Markdown', reply_markup=InlineKeyboardMarkup(keyboard)
            )
            return True
        if st.get('awaiting_2fa'):
            await update.message.reply_text("🔐 Linking in progress. Please enter your 2FA code to continue.")
            return True
    except Exception:
        pass
    return False

async def set_commands_linked(bot, chat_id: int):
    try:
        cmds = [
            BotCommand("start", "Intro to XREX Pay Bot"),
            BotCommand("check_wallet", "Check any wallet address"),
            # BotCommand("otc_quote", "Request a quote"),
            BotCommand("unlink_account", "Unlink from XREX Pay"),
            BotCommand("help", "We’re here to help!")
        ]
        await bot.set_my_commands(commands=cmds, scope=BotCommandScopeChat(chat_id))
    except Exception:
        pass

async def set_commands_unlinked(bot, chat_id: int):
    try:
        cmds = [
            BotCommand("start", "Intro to XREX Pay Bot"),
            BotCommand("link_account", "Link with XREX Pay"),
            BotCommand("help", "We’re here to help!")
        ]
        await bot.set_my_commands(commands=cmds, scope=BotCommandScopeChat(chat_id))
    except Exception:
        pass

async def is_linked_for_user(tg_user_id: int):
    """Query server by Telegram user id to determine if user is linked.
    Returns (linked_bool, session_id_or_None).
    """
    if httpx is None:
        return False, None
    base = os.getenv("STATE_BASE_URL", "").strip() or "https://xrextgbot.vercel.app"
    url = base.rstrip('/') + f"/api/state?tg={tg_user_id}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url)
            if r.status_code == 200:
                d = r.json() or {}
                try:
                    stage = int(d.get('stage') or 0)
                except Exception:
                    stage = 0
                linked = (stage >= 6 and stage != 7)
                return linked, d.get('session_id')
    except Exception:
        pass
    return False, None

async def maybe_notify_link_success(user_id: int, chat_id: int):
    """Fallback: if remote shows stage 6 for this user and we haven't notified, send success now."""
    try:
        if httpx is None:
            return
        base = os.getenv("STATE_BASE_URL", "").strip() or "https://xrextgbot.vercel.app"
        url = base.rstrip('/') + f"/api/state?tg={user_id}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url)
            if r.status_code != 200:
                return
            data = r.json() or {}
            stage = int(data.get('stage') or 0)
            if stage == 6:
                st = user_state.get(user_id, {})
                if st.get('stage6_notified'):
                    return
                if bot_for_notifications and await begin_stage6_notify(user_id):
                    ok = False
                    try:
                        keyboard = [[
                            InlineKeyboardButton("📚 How to use", callback_data="how_to_use"),
                            InlineKeyboardButton("...  More", callback_data="more")
                        ]]
                        reply_markup = InlineKeyboardMarkup(keyboard)
                        await bot_for_notifications.send_message(
                            chat_id=chat_id,
                            text=("🎉 Telegram Bot successfully linked to XREX Pay account @AG***CH\n\n"
                                 "👉 Tap the ‘How to use’ button to see how the XREX Pay Bot simplifies payments and more."),
                            reply_markup=reply_markup
                        )
                        try:
                            await set_commands_linked(bot_for_notifications, chat_id)
                        except Exception:
                            pass
                        ok = True
                    finally:
                        await end_stage6_notify(user_id, ok)
    except Exception:
        pass

def ensure_finalize_watch(tg_user_id: int, chat_id: int):
    try:
        key = int(tg_user_id)
        task = finalize_watch_tasks.get(key)
        if task is None or task.done():
            finalize_watch_tasks[key] = asyncio.create_task(watch_finalize_for_user(tg_user_id=key, chat_id=int(chat_id)))
    except Exception:
        pass

async def watch_finalize_for_user(tg_user_id: int, chat_id: int, timeout_seconds: int = 15):
    if httpx is None:
        return
    base = os.getenv("STATE_BASE_URL", "").strip() or "https://xrextgbot.vercel.app"
    url = base.rstrip('/') + f"/api/state?tg={tg_user_id}"
    started = int(time.time())
    stage4_seen_ts = 0
    try:
        while (int(time.time()) - started) <= int(timeout_seconds):
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    r = await client.get(url)
                    if r.status_code == 200:
                        d = r.json() or {}
                        stage = 0
                        try:
                            stage = int(d.get('stage') or 0)
                        except Exception:
                            stage = 0
                        # Optional: if stuck at stage 5 (code submitted), we can (optionally) push finalize->6
                        # Gate behind env FORCE_FINALIZE_STAGE5=1 and use a conservative delay to avoid premature finalize
                        try:
                            if os.getenv('FORCE_FINALIZE_STAGE5', '0') == '1':
                                if stage == 5 and (d.get('twofa_verified') is True) and (d.get('linking_code')):
                                    if stage4_seen_ts == 0:
                                        stage4_seen_ts = int(time.time())
                                    elif (int(time.time()) - stage4_seen_ts) >= 5:
                                        sess_id = d.get('session_id')
                                        if sess_id:
                                            fin_url = (base.rstrip('/') + "/api/state") + f"?session={sess_id}"
                                            try:
                                                await client.put(fin_url, headers={"Content-Type": "application/json", "X-Client-Stage": "6"}, json={"stage": 6})
                                            except Exception:
                                                pass
                                else:
                                    stage4_seen_ts = 0
                            else:
                                stage4_seen_ts = 0
                        except Exception:
                            pass
                        if stage >= 6 and stage != 7:
                            st = user_state.get(tg_user_id, {})
                            if st.get('stage6_notified'):
                                break
                            if bot_for_notifications and await begin_stage6_notify(tg_user_id):
                                ok = False
                                try:
                                    keyboard = [[
                                        InlineKeyboardButton("📚 How to use", callback_data="how_to_use"),
                                        InlineKeyboardButton("...  More", callback_data="more")
                                    ]]
                                    reply_markup = InlineKeyboardMarkup(keyboard)
                                    try:
                                        await bot_for_notifications.send_message(
                                            chat_id=int(chat_id),
                                            text=("🎉 Telegram Bot successfully linked to XREX Pay account @AG***CH\n\n"
                                                 "Tap the ‘How to use’ button to see how the XREX Pay Bot simplifies payments and more."),
                                            reply_markup=reply_markup
                                        )
                                        try:
                                            await set_commands_linked(bot_for_notifications, int(chat_id))
                                        except Exception:
                                            pass
                                        st['chat_id'] = int(chat_id)
                                        user_state[tg_user_id] = st
                                        ok = True
                                    except Exception:
                                        pass
                                finally:
                                    await end_stage6_notify(tg_user_id, ok)
                            break
            except Exception:
                pass
            await asyncio.sleep(1.0)
    finally:
        try:
            key = int(tg_user_id)
            if finalize_watch_tasks.get(key) and finalize_watch_tasks[key].done():
                finalize_watch_tasks.pop(key, None)
        except Exception:
            pass

async def push_state(stage: int = None, twofa_verified: bool = None, linking_code: str = None, actor_tg_user_id: int = None, actor_chat_id: int = None, session_id: str = None, tg_username: str = None, tg_display_name: str = None, tg_photo_url: str = None):
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
    if tg_username is not None:
        try:
            payload["tg_username"] = str(tg_username)
        except Exception:
            pass
    if tg_display_name is not None:
        try:
            payload["tg_display_name"] = str(tg_display_name)
        except Exception:
            pass
    if tg_photo_url is not None:
        try:
            payload["tg_photo_url"] = str(tg_photo_url)
        except Exception:
            pass
    # Try Vercel API first
    base = os.getenv("STATE_BASE_URL", "").strip()
    token = os.getenv("STATE_WRITE_TOKEN", "").strip()
    if base and token:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                url = base.rstrip('/') + "/api/state"
                if session_id:
                    url = url + ("?session=" + session_id)
                try:
                    logger.info(f"push_state: PUT {url} stage={payload.get('stage')} twofa={payload.get('twofa_verified')} actor_uid={actor_tg_user_id} actor_chat={actor_chat_id}")
                except Exception:
                    pass
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
                                logger.info(f"push_state: starting poller for session {session_id}")
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
    stage5_seen_ts = 0
    forced_finalize_done = False
    last_stage_for_delay = 0
    while True:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                try:
                    logger.debug(f"poller[{session_id or 'none'}]: GET {url_latest}")
                except Exception:
                    pass
                r = await client.get(url_latest)
                if r.status_code == 200:
                    record = r.json() or {}
                    ts = int(record.get('updated_at') or 0)
                    if ts > last_seen:
                        last_seen = ts
                        try:
                            logger.info(f"poller[{session_id or 'none'}]: stage={record.get('stage')} twofa={record.get('twofa_verified')} tg={record.get('actor_tg_user_id')} chat={record.get('actor_chat_id')}")
                        except Exception:
                            pass
                        # If website reset to stage 1 or 2, reflect locally
                        stage = int(record.get('stage') or 0)
                        last_stage_for_delay = stage
                        code = record.get('linking_code')
                        twofa = bool(record.get('twofa_verified'))
                        target_user_id = record.get('actor_tg_user_id')
                        target_chat_id = record.get('actor_chat_id')
                        # Start/extend a 5-minute polling window only in stages 3 or 4
                        if stage == 3 or stage == 4:
                            poll_until_ts = int(time.time()) + 5*60
                        # Aggressive finalize: if stage 5 lingers >2s, force finalize to 6 for this session
                        if stage == 5:
                            try:
                                if stage5_seen_ts == 0:
                                    stage5_seen_ts = int(time.time())
                                elapsed = int(time.time()) - int(stage5_seen_ts)
                                if (elapsed >= 2) and (not forced_finalize_done):
                                    fin_url = url_latest
                                    try:
                                        logger.info(f"poller[{session_id or 'none'}]: forcing finalize to 6 after {elapsed}s at stage 5")
                                    except Exception:
                                        pass
                                    try:
                                        await client.put(fin_url, headers={"Content-Type": "application/json", "X-Client-Stage": "6"}, json={"stage": 6})
                                        forced_finalize_done = True
                                    except Exception:
                                        pass
                            except Exception:
                                pass
                        else:
                            stage5_seen_ts = 0
                        if stage <= 2:
                            set_sync_state(stage=stage or 1, twofa_verified=False, linking_code=None)
                            # Reset per-user notification flags so future link/unlink events notify again
                            try:
                                for uid, st in list(user_state.items()):
                                    if st.get('stage6_notified'):
                                        st.pop('stage6_notified', None)
                                    if st.get('stage6_inflight'):
                                        st.pop('stage6_inflight', None)
                                    if st.get('stage7_notified'):
                                        st.pop('stage7_notified', None)
                                    user_state[uid] = st
                            except Exception:
                                pass
                            # Ensure commands are unlinked silently when session drops to <=2
                            try:
                                if bot_for_notifications:
                                    if target_chat_id is not None:
                                        try:
                                            await set_commands_unlinked(bot_for_notifications, int(target_chat_id))
                                        except Exception:
                                            pass
                                    else:
                                        try:
                                            for uid2, st2 in list(user_state.items()):
                                                if st2.get('session_id') == session_id and st2.get('chat_id') is not None:
                                                    try:
                                                        await set_commands_unlinked(bot_for_notifications, int(st2.get('chat_id')))
                                                    except Exception:
                                                        pass
                                                    break
                                        except Exception:
                                            pass
                                # cancel any finalize watcher for this user if known
                                try:
                                    if target_user_id is not None:
                                        tw = finalize_watch_tasks.get(int(target_user_id))
                                        if tw:
                                            try:
                                                tw.cancel()
                                            except Exception:
                                                pass
                                            finalize_watch_tasks.pop(int(target_user_id), None)
                                except Exception:
                                    pass
                            except Exception:
                                pass
                        else:
                            set_sync_state(stage=stage, twofa_verified=twofa, linking_code=code)
                            try:
                                # If we see stage 4/5 for this session, start a finalize watch keyed by user id
                                if (stage == 4 or stage == 5):
                                    if target_user_id and target_chat_id:
                                        ensure_finalize_watch(tg_user_id=int(target_user_id), chat_id=int(target_chat_id))
                                    else:
                                        # Map session_id -> user via local user_state (fallback when actor ids missing)
                                        try:
                                            for uid2, st2 in list(user_state.items()):
                                                if st2.get('session_id') == session_id and st2.get('chat_id'):
                                                    ensure_finalize_watch(tg_user_id=int(uid2), chat_id=int(st2.get('chat_id')))
                                                    break
                                        except Exception:
                                            pass
                            except Exception:
                                pass
                        # Test message: if send_test_at is present, send and clear
                        try:
                            send_test_at = record.get('send_test_at')
                            if send_test_at:
                                # Determine target chat/user
                                target_uid = None
                                target_chat = None
                                try:
                                    if target_user_id is not None:
                                        target_uid = int(target_user_id)
                                except Exception:
                                    target_uid = None
                                try:
                                    if target_chat_id is not None:
                                        target_chat = int(target_chat_id)
                                except Exception:
                                    target_chat = None
                                # Fallback by session mapping
                                if target_uid is None or target_chat is None:
                                    try:
                                        for uid3, st3 in list(user_state.items()):
                                            if st3.get('session_id') == session_id:
                                                if target_uid is None:
                                                    try: target_uid = int(uid3)
                                                    except Exception: pass
                                                if target_chat is None:
                                                    try: target_chat = int(st3.get('chat_id')) if st3.get('chat_id') is not None else None
                                                    except Exception: target_chat = None
                                                if target_uid is not None and target_chat is not None:
                                                    break
                                    except Exception:
                                        pass
                                if bot_for_notifications and target_chat is not None:
                                    try:
                                        await bot_for_notifications.send_message(
                                            chat_id=target_chat,
                                            text=("🧪 Test message from XREX Pay Bot. This Bot is currently linked to the XREX Pay account @12*****78.")
                                        )
                                    except Exception:
                                        pass
                                # Clear the flag via API to avoid repeats
                                try:
                                    clear_url = url_latest
                                    async with httpx.AsyncClient(timeout=10.0) as c2:
                                        await c2.put(clear_url, headers={"Content-Type": "application/json", "Authorization": f"Bearer {os.getenv('STATE_WRITE_TOKEN','').strip()}"}, json={"send_test_at": None})
                                except Exception:
                                    pass
                        except Exception:
                            pass

                        # Abort message: if send_abort_at is present, send and clear
                        try:
                            send_abort_at = record.get('send_abort_at')
                            if send_abort_at:
                                # Determine target chat/user (reuse logic from test message)
                                target_uid2 = None
                                target_chat2 = None
                                try:
                                    if target_user_id is not None:
                                        target_uid2 = int(target_user_id)
                                except Exception:
                                    target_uid2 = None
                                try:
                                    if target_chat_id is not None:
                                        target_chat2 = int(target_chat_id)
                                except Exception:
                                    target_chat2 = None
                                if target_uid2 is None or target_chat2 is None:
                                    try:
                                        for uid4, st4 in list(user_state.items()):
                                            if st4.get('session_id') == session_id:
                                                if target_uid2 is None:
                                                    try: target_uid2 = int(uid4)
                                                    except Exception: pass
                                                if target_chat2 is None:
                                                    try: target_chat2 = int(st4.get('chat_id')) if st4.get('chat_id') is not None else None
                                                    except Exception: target_chat2 = None
                                                if target_uid2 is not None and target_chat2 is not None:
                                                    break
                                    except Exception:
                                        pass
                                if bot_for_notifications and target_chat2 is not None:
                                    try:
                                        await bot_for_notifications.send_message(
                                            chat_id=target_chat2,
                                            text=("🚫 You’ve aborted the linking process.\n\n👉 If you wish to continue later, simply start the linking process again in the XREX Pay web app.\n\n🔒 Your account remains secure.")
                                        )
                                    except Exception:
                                        pass
                                # Clear the flag via API to avoid repeats
                                try:
                                    clear_url2 = url_latest
                                    async with httpx.AsyncClient(timeout=10.0) as c3:
                                        await c3.put(clear_url2, headers={"Content-Type": "application/json", "Authorization": f"Bearer {os.getenv('STATE_WRITE_TOKEN','').strip()}"}, json={"send_abort_at": None})
                                except Exception:
                                    pass
                        except Exception:
                            pass

                        # Detect session expiry transition (>=3 -> <=2)
                        try:
                            if prev_stage is not None and prev_stage >= 3 and stage <= 2:
                                # If this downgrade was triggered by an explicit abort (send_abort_at set),
                                # suppress the generic "Session expired" message to avoid double notifications.
                                try:
                                    aborted_flag = record.get('send_abort_at')
                                except Exception:
                                    aborted_flag = None
                                if aborted_flag:
                                    try:
                                        if session_id:
                                            info0 = session_subscriptions.get(session_id, {})
                                            info0['expiry_notified'] = True
                                            session_subscriptions[session_id] = info0
                                    except Exception:
                                        pass
                                    # Skip sending the expiry message
                                    raise Exception("skip_expiry_due_to_abort")
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
                                        # Reset bot-side flow so 2FA inputs are ignored and clear cached TG profile
                                        st = user_state.get(notif_user_id, {})
                                        st['awaiting_2fa'] = False
                                        # Also clear any cached tg profile and session so a fresh flow starts clean
                                        st.pop('tg_username', None)
                                        st.pop('tg_display_name', None)
                                        st.pop('tg_photo_url', None)
                                        st.pop('verify_token', None)
                                        st.pop('verification_code', None)
                                        st.pop('session_id', None)
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
                        # Stage 6: Linked success notification (only on transition into 6)
                        if stage == 6 and prev_stage != 6:
                            try:
                                notified_any = False
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
                                    if st.get('stage6_notified'):
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
                                        if bot_for_notifications and await begin_stage6_notify(uid):
                                            ok = False
                                            try:
                                                await bot_for_notifications.send_message(
                                                    chat_id=chat_id,
                                                    text=("🎉 Telegram Bot successfully linked to XREX Pay account @AG***CH\n\n"
                                                         "Tap the ‘How to use’ button to see how the XREX Pay Bot simplifies payments and more."),
                                                    reply_markup=reply_markup
                                                )
                                                try:
                                                    await set_commands_linked(bot_for_notifications, chat_id)
                                                except Exception:
                                                    pass
                                                ok = True
                                            finally:
                                                await end_stage6_notify(uid, ok)
                                            notified_any = True
                                    except Exception:
                                        pass
                                # Fallback: if actor ids provided but not in user_state, send directly once
                                if (not notified_any) and target_user_id is not None and target_chat_id is not None:
                                    try:
                                        uid_key = int(target_user_id)
                                        st = user_state.get(uid_key, {})
                                        already = st.get('stage6_notified')
                                        if not already and bot_for_notifications and await begin_stage6_notify(uid_key):
                                            ok2 = False
                                            try:
                                                await bot_for_notifications.send_message(
                                                    chat_id=int(target_chat_id),
                                                    text=("✅️ Telegram Bot successfully linked to XREX Pay account @AG***CH\n\n"
                                                         "Tap the ‘How to use’ button to see how the XREX Pay Bot simplifies payments and more.")
                                                )
                                                try:
                                                    await set_commands_linked(bot_for_notifications, int(target_chat_id))
                                                except Exception:
                                                    pass
                                                st['stage6_notified'] = True
                                                # Ensure chat_id stored for future interactions
                                                st['chat_id'] = int(target_chat_id)
                                                user_state[uid_key] = st
                                                ok2 = True
                                                notified_any = True
                                            finally:
                                                await end_stage6_notify(uid_key, ok2)
                                    except Exception:
                                        pass
                            except Exception:
                                pass
                        # Stage 7: Unlinked notification (only on transition into 7)
                        elif stage == 7 and prev_stage != 7:
                            try:
                                notified_any_7 = False
                                for uid, st in list(user_state.items()):
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
                                    if st.get('stage7_notified'):
                                        continue
                                    try:
                                        if bot_for_notifications:
                                            await bot_for_notifications.send_message(
                                                chat_id=chat_id,
                                                text=("🔌️ Telegram Bot successfully unlinked from XREX Pay account @AG***CH")
                                            )
                                            try:
                                                await set_commands_unlinked(bot_for_notifications, chat_id)
                                            except Exception:
                                                pass
                                            st['stage7_notified'] = True
                                            user_state[uid] = st
                                            notified_any_7 = True
                                    except Exception:
                                        pass
                                if (not notified_any_7) and target_user_id is not None and target_chat_id is not None:
                                    try:
                                        uid_key = int(target_user_id)
                                        st = user_state.get(uid_key, {})
                                        if not st.get('stage7_notified') and bot_for_notifications:
                                            await bot_for_notifications.send_message(
                                                chat_id=int(target_chat_id),
                                                text=("✅️ Telegram Bot successfully unlinked from XREX Pay account @AG***CH")
                                            )
                                            try:
                                                await set_commands_unlinked(bot_for_notifications, int(target_chat_id))
                                            except Exception:
                                                pass
                                            st['stage7_notified'] = True
                                            st['chat_id'] = int(target_chat_id)
                                            user_state[uid_key] = st
                                            notified_any_7 = True
                                    except Exception:
                                        pass
                            except Exception:
                                pass
                        # Update previous stage after handling notifications
                        prev_stage = stage
        except Exception:
            pass
        # Sleep longer when idle; if within 5-min window, keep 60s; otherwise back off to 5 minutes
        try:
            now_ts = int(time.time())
            if (last_stage_for_delay == 5):
                base_delay = 0.5   # very aggressive during stage 5
            elif poll_until_ts and now_ts < poll_until_ts:
                base_delay = 1.0   # active window faster
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

def detect_chain_and_explorer(address: str):
    try:
        addr = (address or '').strip()
        low = addr.lower()
        # ETH
        if low.startswith('0x') and len(low) >= 10:
            return 'Ethereum', f"https://etherscan.io/address/{addr}"
        # BTC (basic heuristics)
        if low.startswith('bc1') or low.startswith('1') or low.startswith('3'):
            return 'Bitcoin', f"https://www.blockchain.com/btc/address/{addr}"
        # TRON
        if addr.startswith('T'):
            return 'TRON', f"https://tronscan.org/#/address/{addr}"
        return 'Unknown', ''
    except Exception:
        return 'Unknown', ''

def render_wallet_details(address: str) -> str:
    chain, explorer = detect_chain_and_explorer(address)
    # Derive explorer base (up to 'address/' if present)
    try:
        base = explorer
        for token in ['/address/', '/#/address/']:
            if token in explorer:
                base = explorer.split(token)[0] + token
                break
    except Exception:
        base = explorer
    lines = []
    lines.append("📎 Your queried wallet address:")
    lines.append(f"<b>{address}" + "69zkqmk6ee3ewf0j77s3h</b>")
    # Show only one explorer reference (prefer full link if available)
    if explorer:
        lines.append(explorer)
    elif base:
        lines.append(base)
    lines.append(f"Blockchain: <b>{chain}</b>")
    lines.append("📌 Exchange: <b>XREX</b>")
    lines.append("https://xrex.io/xray/app/entity/6")
    lines.append("On-chain Label: <b>None</b>")
    lines.append("Address Category: <b>Unknown</b>")
    lines.append("On-chain Wallet Balance:")
    lines.append("(Note: Due to different accounting logic among exchanges, the balance shown here does not equal")
    lines.append("'user assets in the exchange account')")
    lines.append("• <b>17.50 USDT</b>")
    lines.append("Risk Level: <b>Low 🟢</b>")
    lines.append("Risk Description: <b>None</b>")
    return "\n".join(lines)

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    logger.debug(f"Entering start for user {update.effective_user.id}")
    user_name = update.effective_user.first_name
    user_id = update.effective_user.id
    chat_id = update.effective_chat.id
    is_group = update.message.chat.type in ['group', 'supergroup']
    # Opportunistically capture profile and upload avatar in the background
    try:
        asyncio.create_task(capture_and_cache_tg_profile(update, context))
    except Exception:
        pass
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
            # Reset Telegram-side "linked" status for this user (prototype) without notifying
            try:
                st_reset = user_state.get(user_id, {})
                if 'stage6_notified' in st_reset: st_reset.pop('stage6_notified', None)
                if 'stage6_inflight' in st_reset: st_reset.pop('stage6_inflight', None)
                if 'stage7_notified' in st_reset: st_reset.pop('stage7_notified', None)
                user_state[user_id] = st_reset
                try:
                    await set_commands_unlinked(context.bot, chat_id)
                except Exception:
                    pass
                # Cancel any in-flight finalize watcher to avoid stale success notices
                try:
                    tw = finalize_watch_tasks.get(int(user_id))
                    if tw:
                        try:
                            tw.cancel()
                        except Exception:
                            pass
                        finalize_watch_tasks.pop(int(user_id), None)
                except Exception:
                    pass
            except Exception:
                pass
            keyboard = [[
                InlineKeyboardButton("📋 What is 2FA", callback_data="what_is_2fa"),
                InlineKeyboardButton("...  More", callback_data="more")
            ]]
            reply_markup = InlineKeyboardMarkup(keyboard)
            try:
                sent = await update.message.reply_text(
                    "️🔍 Valid unique verification link detected from XREX Pay account \"@AG***CH\"\n\n"
                    "️👉 Please enter your XREX Pay 2FA here, to proceed with linking your Telegram account to XREX Pay.",
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
                    prof = user_state.get(user_id, {})
                    await push_state(stage=3, twofa_verified=False, linking_code='NDG341F', actor_tg_user_id=user_id, actor_chat_id=chat_id, session_id=session_id, tg_username=prof.get('tg_username'), tg_display_name=prof.get('tg_display_name'), tg_photo_url=prof.get('tg_photo_url'))
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
    
    # Normal start flow (no verification token) – mid-flow guard
    try:
        if await guard_midflow_and_remind(update, context):
            return
    except Exception:
        pass

    try:
        linked, last_session = await is_linked_for_user(user_id)
    except Exception:
        linked, last_session = (False, None)

    if linked:
        try:
            # Persist session for later unlink operations
            st = user_state.get(user_id, {})
            if last_session:
                st['session_id'] = last_session
            st['chat_id'] = chat_id
            user_state[user_id] = st
        except Exception:
            pass
        try:
            await set_commands_linked(context.bot, chat_id)
        except Exception:
            pass
        # Fallback: if poller misses stage 6, explicitly verify and notify once
        try:
            await maybe_notify_link_success(user_id=user_id, chat_id=chat_id)
        except Exception:
            pass
        keyboard = [[
            InlineKeyboardButton("📚 How to use", url=xrex_link_url()),
            InlineKeyboardButton("...  More", url=xrex_link_url())
        ]]
        reply_markup = InlineKeyboardMarkup(keyboard)
        try:
            await update.message.reply_text(
                "You're linked with XREX Pay: Tap the ‘How to use’ button to see how the XREX Pay Bot simplifies payments and more.",
                reply_markup=reply_markup
            )
        except Exception:
            pass
        return

    try:
        await set_commands_unlinked(context.bot, chat_id)
    except Exception:
        pass
    keyboard = [[InlineKeyboardButton("↗️ Go to XREX Pay", url=xrex_link_url())]]
    reply_markup = InlineKeyboardMarkup(keyboard)
    try:
        await update.message.reply_text(
            "👋 Welcome to the XREX Pay Bot, you haven’t linked your XREX Pay account yet, please visit the XREX Pay Webapp first",
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
                "Not in prototype"
            )
        )
        return

    # Help center callback
    if data == "notify_am":
        await context.bot.send_message(
            chat_id=query.message.chat_id,
            text="🔔 Account manager notified, please wait..."
        )
        return

    if data == "init_unlink":
        # Find session for this user, prefer stored one; otherwise query latest by tg
        sess = user_state.get(user_id, {}).get('session_id')
        if not sess:
            try:
                _, sess = await is_linked_for_user(user_id)
            except Exception:
                sess = None
        if not sess:
            await context.bot.send_message(
                chat_id=query.message.chat_id,
                text="Unable to find your active session. Please open XREX Pay and unlink from there."
            )
            return
        if httpx is None:
            await context.bot.send_message(
                chat_id=query.message.chat_id,
                text="Network client unavailable to unlink right now."
            )
            return
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                base = os.getenv("STATE_BASE_URL", "").strip() or "https://xrextgbot.vercel.app"
                url = base.rstrip('/') + f"/api/state?session={sess}"
                await client.put(url, headers={"Content-Type": "application/json", "X-Client-Stage": "7"}, json={"stage": 7})
            await context.bot.send_message(chat_id=query.message.chat_id, text="Unlinked successfully.")
            try:
                await set_commands_unlinked(context.bot, query.message.chat_id)
            except Exception:
                pass
        except Exception:
            await context.bot.send_message(chat_id=query.message.chat_id, text="Could not unlink right now. Please try again.")
        return

async def link_account_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [[InlineKeyboardButton("↗️ Go to XREX Pay", url=xrex_link_url())]]
    await update.message.reply_text(
        "To link this Telegram bot with XREX Pay, please visit the XREX Pay Webapp first",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )

async def unlink_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    # Spec: only show guidance; do not unlink via API
    try:
        st = user_state.get(update.effective_user.id, {})
        if st.get('awaiting_verification'):
            keyboard_v = [[InlineKeyboardButton("Generate New Code", callback_data="generate_new_code")]]
            await update.message.reply_text(
                f"🔐 Verification in progress\n\nYour verification code is: `{st.get('verification_code','N/A')}`",
                parse_mode='Markdown', reply_markup=InlineKeyboardMarkup(keyboard_v)
            )
            return
        if st.get('awaiting_2fa'):
            await update.message.reply_text("🔐 Linking in progress. Please enter your 2FA code to continue.")
            return
    except Exception:
        pass
    keyboard = [[InlineKeyboardButton("↗️ Go to XREX Pay", url=xrex_link_url())]]
    await update.message.reply_text(
        "To Unlink this Telegram bot from XREX Pay, please visit the XREX Pay Webapp",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )

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
                # "• /otc_quote — Request a real-time OTC quote\n"
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
    try:
        if await guard_midflow_and_remind(update, context):
            return
    except Exception:
        pass
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

                await update.message.reply_text("🔐 2FA verified! \n\nGenerating linking code... ")
                await asyncio.sleep(1)

                # Generate a dynamic linking code per session/user
                try:
                    sid = None
                    try:
                        last_token = user_state.get(user_id, {}).get('verify_token')
                        if last_token and '_s' in last_token:
                            sid = last_token.split('_s',1)[1]
                    except Exception:
                        sid = None
                    # Simple deterministic code per session/user for demo
                    base = (sid or '') + ':' + str(user_id)
                    import hashlib
                    code_hash = hashlib.sha1(base.encode('utf-8')).hexdigest().upper()
                    linking_code = code_hash[:6]
                except Exception:
                    linking_code = state.get('linking_code', 'NDG341F')
                try:
                    await update.message.reply_text('<b>' + linking_code + '</b>', parse_mode='HTML', disable_web_page_preview=True)
                except Exception as send_code_e:
                    logger.error(f"Failed to send HTML linking code, falling back to plain text: {str(send_code_e)}")
                    await update.message.reply_text('Linking code: ' + linking_code)

                # Final instruction with buttons and pin
                keyboard = [[
                    InlineKeyboardButton("↗️ Go to XREX Pay", url="https://xrextgbot.vercel.app/"),
                    InlineKeyboardButton("📋 Copy code", callback_data="copy_code")
                ], [
                    InlineKeyboardButton("...  More", callback_data="more")
                ]]
                reply_markup = InlineKeyboardMarkup(keyboard)
                try:
                    final_msg = await update.message.reply_text(
                        "👉 Please go to XREX Pay, and enter this linking code there. <br>(Valid for 5 minutes)",
                        parse_mode='HTML',
                        disable_web_page_preview=True,
                        reply_markup=reply_markup
                    )
                except Exception as send_instr_e:
                    logger.error(f"Failed to send HTML instruction, falling back: {str(send_instr_e)}")
                    final_msg = await update.message.reply_text(
                        "👉 Please go to XREX Pay, and enter this linking code there. (Valid for 5 minutes)",
                        disable_web_page_preview=True,
                        reply_markup=reply_markup
                    )
                # No pinning per updated spec

                # Update state to stop awaiting 2FA
                state['awaiting_2fa'] = False
                state['linking_code'] = linking_code
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
                    prof = user_state.get(user_id, {})
                    await push_state(stage=4, twofa_verified=True, linking_code=linking_code, actor_tg_user_id=user_id, actor_chat_id=update.message.chat_id, session_id=sess, tg_username=prof.get('tg_username'), tg_display_name=prof.get('tg_display_name'), tg_photo_url=prof.get('tg_photo_url'))
                    try:
                        ensure_finalize_watch(tg_user_id=user_id, chat_id=update.message.chat_id)
                    except Exception:
                        pass
                except Exception:
                    pass
                return
            else:
                # Gentle reminder only (do not unpin original instruction)
                await update.message.reply_text(
                    "❌ The 2FA code you entered is incorrect or expired. Please try again with a valid code."
                )
                return

        # Handle awaiting wallet address for /check_wallet
        if state.get('awaiting_wallet_address'):
            addr = update.message.text.strip()
            # Clear flag
            state['awaiting_wallet_address'] = False
            user_state[user_id] = state
            # Render response
            await update.message.reply_text(render_wallet_details(addr), parse_mode='HTML', disable_web_page_preview=True)
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

async def help_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        if await guard_midflow_and_remind(update, context):
            return
    except Exception:
        pass
    keyboard = [[
        InlineKeyboardButton("↗️ Help center", url="https://intercom.help/xrex-sg/en/"),
        InlineKeyboardButton("🔔 Account manager", callback_data="notify_am")
    ]]
    await update.message.reply_text(
        "We're here to help, visit our Help center or request help from an Account manager",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )

# Deprecated alias kept temporarily if referenced elsewhere
async def wallet_check_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await check_wallet_cmd(update, context)

async def check_wallet_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        if await guard_midflow_and_remind(update, context):
            return
    except Exception:
        pass
    try:
        linked, _ = await is_linked_for_user(update.effective_user.id)
    except Exception:
        linked = False
    if not linked:
        await update.message.reply_text("Your Telegram is not linked. Open XREX Pay to link first.")
        return
    # Parse argument after /check_wallet
    args = context.args if hasattr(context, 'args') else []
    addr = (args[0].strip() if args and isinstance(args[0], str) else '')
    if not addr:
        msg = (
            "🔎 Please provide wallet address hash: I will help you check the wallet.\n\n"
            "Supported blockchains:\n"
            "<b>Bitcoin</b> (BTC)\n"
            "<b>Ethereum</b> (ETH)\n"
            "<b>TRON</b> (TRX)\n\n"
            "👉 👉 Did you know? You can check up to 10 addresses at once by entering one per line."
        )
        await update.message.reply_text(msg)
        # Set awaiting flag to capture next user message as address
        st = user_state.get(update.effective_user.id, {})
        st['awaiting_wallet_address'] = True
        user_state[update.effective_user.id] = st
        return
    await update.message.reply_text(render_wallet_details(addr), parse_mode='HTML', disable_web_page_preview=True)

async def otc_quote_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    # Guard linking in progress
    try:
        st = user_state.get(update.effective_user.id, {})
        if st.get('awaiting_verification'):
            keyboard_v = [[InlineKeyboardButton("Generate New Code", callback_data="generate_new_code")]]
            await update.message.reply_text(
                f"🔐 Verification in progress\n\nYour verification code is: `{st.get('verification_code','N/A')}`",
                parse_mode='Markdown', reply_markup=InlineKeyboardMarkup(keyboard_v)
            )
            return
        if st.get('awaiting_2fa'):
            await update.message.reply_text("🔐 Linking in progress. Please enter your 2FA code to continue.")
            return
    except Exception:
        pass
    try:
        linked, _ = await is_linked_for_user(update.effective_user.id)
    except Exception:
        linked = False
    if not linked:
        await update.message.reply_text("Your Telegram is not linked. Open XREX Pay to link first.")
        return
    await update.message.reply_text("Coming soon!")

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
        application.add_handler(CommandHandler("link_account", link_account_cmd), group=1)
        application.add_handler(CommandHandler("help", help_cmd), group=1)
        application.add_handler(CommandHandler("check_wallet", check_wallet_cmd), group=1)
        # application.add_handler(CommandHandler("otc_quote", otc_quote_cmd), group=1)
        application.add_handler(CommandHandler("unlink_account", unlink_cmd), group=1)
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