# Telegram Mini App Setup Guide

## Overview

This guide explains how to set up and deploy a Telegram Mini App for your OTC trading bot.

## What You've Added

Your bot now includes:

- A mini app button in the start menu
- A web app data handler to process mini app submissions
- A complete HTML mini app with trading interface

## Deployment Steps

### 1. Host Your Mini App

You need to host the `miniapp.html` file on a web server with HTTPS. Here are some options:

#### Option A: GitHub Pages (Free)

1. Create a new GitHub repository
2. Upload `miniapp.html` to the repository
3. Enable GitHub Pages in repository settings
4. Your URL will be: `https://yourusername.github.io/repository-name/miniapp.html`

#### Option B: Netlify (Free)

1. Go to [netlify.com](https://netlify.com)
2. Drag and drop your `miniapp.html` file
3. Get your URL (e.g., `https://random-name.netlify.app/miniapp.html`)

#### Option C: Vercel (Free)

1. Go to [vercel.com](https://vercel.com)
2. Deploy your HTML file
3. Get your URL

### 2. Update Your Bot Code

In `otc_bot.py`, replace the placeholder URL:

```python
[InlineKeyboardButton("🚀 Open OTC Mini App", web_app=WebAppInfo(url="https://your-domain.com/miniapp.html"))]
```

With your actual deployed URL:

```python
[InlineKeyboardButton("🚀 Open OTC Mini App", web_app=WebAppInfo(url="https://yourusername.github.io/repository-name/miniapp.html"))]
```

### 3. Test Your Mini App

1. Start your bot: `python otc_bot.py`
2. Send `/start` to your bot
3. Click "🚀 Open OTC Mini App"
4. The mini app should open within Telegram
5. Fill out the form and click "Request Quote"
6. You should receive a confirmation message in the chat

## Mini App Features

### Current Features

- ✅ Native Telegram theme integration
- ✅ Responsive design for mobile
- ✅ Real-time quote preview
- ✅ Haptic feedback
- ✅ Data validation
- ✅ Seamless integration with bot

### How It Works

1. User clicks the mini app button
2. Mini app opens in Telegram's in-app browser
3. User selects trade direction (USD/USDT or USDT/USD)
4. User enters amount
5. App shows preview with estimated exchange
6. User clicks "Request Quote"
7. Data is sent back to the bot as JSON
8. Bot processes the request and shows confirmation

## Customization Options

### Styling

The mini app uses Telegram's theme variables, so it automatically adapts to:

- Light/Dark mode
- User's color preferences
- Telegram's native look and feel

### Adding Features

You can extend the mini app by adding:

- Real-time exchange rates API
- Trade history
- User preferences
- Advanced order types
- Price alerts

### Security Considerations

- Always use HTTPS for your mini app URL
- Validate all data received from the mini app
- Never store sensitive information in the mini app
- Use Telegram's built-in user verification

## Troubleshooting

### Common Issues

1. **Mini app doesn't open**: Check that your URL is HTTPS
2. **No data received**: Ensure the web app data handler is registered
3. **Theme issues**: Verify you're using Telegram's CSS variables
4. **Button not showing**: Make sure WebAppInfo is imported correctly

### Debug Mode

Add this to your mini app for debugging:

```javascript
console.log("Telegram WebApp object:", tg);
console.log("User data:", tg.initDataUnsafe?.user);
```

## Next Steps

- Deploy your mini app to a hosting service
- Update the URL in your bot code
- Test thoroughly with different users
- Consider adding more advanced features
- Monitor usage and gather user feedback

Your mini app is now ready to provide a modern, native-feeling trading experience within Telegram!
