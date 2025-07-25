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

# Configure detailed logging
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.DEBUG
)
logger = logging.getLogger(__name__)

# Hardcode bot token for testing
BOT_TOKEN = "8052956286:AAEpC6pkI776nKtGiNjdmPNJ2QkPQFbLfXQ"

user_state = {}

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
    
    # Check if this is a deeplink with verification token
    if context.args and len(context.args) > 0:
        verify_token = context.args[0]
        logger.info(f"Deeplink accessed with verify token: {verify_token} by user {user_id}")
        
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
    keyboard = [
        [InlineKeyboardButton("request a quote", callback_data="request_quote")],
        [InlineKeyboardButton("🧪 Test Quote (Simple)", callback_data="test_quote")],
        [InlineKeyboardButton("🚀 Open OTC Mini App", web_app=WebAppInfo(url="https://sannemeijer1986.github.io/xrextgbot/miniapp.html"))]
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    try:
        sent_message = await update.message.reply_text(
            f"{user_name}, welcome to XREX Telegram OTC Bot\n"
            f"This is an OTC agent bot, designed for fast Telegram OTC deals.\n\n"
            f"Your Telegram User ID: {user_id}\n"
            f"This Chat ID: {chat_id}",
            reply_markup=reply_markup
        )
        user_state[user_id] = {'previous_message_id': sent_message.message_id, 'initiator_id': user_id}
        logger.info(f"Sent start message for user {update.message.from_user.id}")
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

        elif data == "test_quote":
            logger.info(f"Processing test_quote for user {user_id}")
            
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

async def handle_web_app_data(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle data sent from the mini app"""
    user_id = update.effective_user.id
    user_name = update.effective_user.first_name
    user_username = update.effective_user.username
    chat_id = update.effective_chat.id
    is_group = update.message.chat.type in ['group', 'supergroup']
    
    logger.info(f"WEB APP DATA HANDLER TRIGGERED for user {user_id}")
    logger.debug(f"Received web app data from user {user_id}: {update.message.web_app_data.data}")
    
    try:
        # Get the simple data
        data = update.message.web_app_data.data
        logger.info(f"Received data: {data}")
        
        # Create user display name (with username if available)
        user_display = f"{user_name}"
        if user_username:
            user_display += f" (@{user_username})"
        
        # Simple static message
        if data == "QUOTE_REQUEST":
            # Create the simple order message
            if is_group:
                order_header = "📢 **NEW OTC ORDER REQUEST**"
                context_text = f"Group: {update.effective_chat.title or 'Group Chat'}"
            else:
                order_header = "🚀 **OTC ORDER REQUEST**"
                context_text = "Private Chat"
            
            # Create a basic order message
            order_message = (
                f"{order_header}\n\n"
                f"👤 **Trader:** {user_display}\n"
                f"📱 **User ID:** `{user_id}`\n"
                f"🏢 **Context:** {context_text}\n"
                f"⏰ **Time:** {update.message.date.strftime('%H:%M:%S UTC')}\n\n"
                f"🔄 **Processing Quote Request...**\n"
                f"Expected waiting time: 1–2 minutes\n\n"
                f"*Order submitted via XREX Mini App (Button Click)*"
            )
            
            logger.info(f"Sending order message to chat {chat_id}")
            
            # Send the public order message
            await context.bot.send_message(
                chat_id=chat_id,
                text=order_message,
                parse_mode='Markdown'
            )
            
            logger.info(f"Order message sent successfully")
            
            # Also send a brief confirmation to the user
            confirmation_message = (
                f"✅ Your quote request has been submitted and broadcast to the chat!\n\n"
                f"**Status:** Processing request..."
            )
            
            await update.message.reply_text(
                confirmation_message,
                parse_mode='Markdown'
            )
            
            logger.info(f"Processed simple quote request for user {user_id} in {'group' if is_group else 'private'} chat {chat_id}")
            
        elif data == "QUOTE_REQUEST_AUTO":
            # Handle auto-send from mini app load
            if is_group:
                order_header = "📢 **NEW OTC ORDER REQUEST (AUTO)**"
                context_text = f"Group: {update.effective_chat.title or 'Group Chat'}"
            else:
                order_header = "🚀 **OTC ORDER REQUEST (AUTO)**"
                context_text = "Private Chat"
            
            # Create a basic order message
            order_message = (
                f"{order_header}\n\n"
                f"👤 **Trader:** {user_display}\n"
                f"📱 **User ID:** `{user_id}`\n"
                f"🏢 **Context:** {context_text}\n"
                f"⏰ **Time:** {update.message.date.strftime('%H:%M:%S UTC')}\n\n"
                f"🔄 **Processing Auto Quote Request...**\n"
                f"Expected waiting time: 1–2 minutes\n\n"
                f"*Order auto-submitted via XREX Mini App (On Load)*"
            )
            
            logger.info(f"Sending auto order message to chat {chat_id}")
            
            # Send the public order message
            await context.bot.send_message(
                chat_id=chat_id,
                text=order_message,
                parse_mode='Markdown'
            )
            
            logger.info(f"Auto order message sent successfully")
            
            # Also send a brief confirmation to the user
            confirmation_message = (
                f"✅ Your auto quote request has been submitted and broadcast to the chat!\n\n"
                f"**Status:** Processing auto request..."
            )
            
            await update.message.reply_text(
                confirmation_message,
                parse_mode='Markdown'
            )
            
            logger.info(f"Processed auto quote request for user {user_id} in {'group' if is_group else 'private'} chat {chat_id}")
        else:
            logger.warning(f"Unknown data received: {data}")
            await update.message.reply_text(f"{user_name}, received unknown request.")
        
    except Exception as e:
        logger.error(f"Error handling web app data for user {user_id}: {str(e)}")
        logger.error(f"Exception details: {type(e).__name__}: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        await update.message.reply_text(
            f"{user_name}, an error occurred. Please try again."
        )

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
    try:
        logger.info("Starting bot...")
        application = ApplicationBuilder().token(BOT_TOKEN).build()
        await application.initialize()
        await check_webhook(application.bot)
        application.add_handler(CommandHandler("start", start))
        application.add_handler(CallbackQueryHandler(handle_callback))
        application.add_handler(MessageHandler(filters.StatusUpdate.WEB_APP_DATA, handle_web_app_data))
        application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
        application.add_handler(CommandHandler("test_webapp", test_webapp))
        logger.info("Bot handlers registered, starting polling...")
        await application.start()  # Start the application explicitly
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

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Bot stopped by user (KeyboardInterrupt).")
    except Exception as e:
        logger.error(f"Error in asyncio.run: {str(e)}")