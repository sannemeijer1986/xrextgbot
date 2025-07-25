#!/usr/bin/env python3
"""
Simple local HTTPS server for testing the Telegram Mini App locally.
This creates a self-signed certificate for testing purposes only.

Usage: python test_miniapp_local.py
Then update your bot with: https://localhost:8443/miniapp.html

Note: You'll need to accept the security warning in Telegram since it's a self-signed certificate.
For production, use a proper hosting service with valid SSL.
"""

import http.server
import ssl
import os
import socket
from pathlib import Path

def create_self_signed_cert():
    """Create a self-signed certificate for local testing"""
    try:
        import subprocess
        
        # Check if certificate already exists
        if Path('server.crt').exists() and Path('server.key').exists():
            print("✅ Using existing SSL certificate")
            return True
        
        print("🔐 Creating self-signed SSL certificate...")
        
        # Create self-signed certificate
        cmd = [
            'openssl', 'req', '-x509', '-newkey', 'rsa:4096', '-keyout', 'server.key',
            '-out', 'server.crt', '-days', '365', '-nodes', '-subj',
            '/C=US/ST=State/L=City/O=Organization/CN=localhost'
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        if result.returncode == 0:
            print("✅ SSL certificate created successfully")
            return True
        else:
            print(f"❌ Error creating certificate: {result.stderr}")
            return False
            
    except subprocess.CalledProcessError as e:
        print(f"❌ Error creating certificate: {e}")
        return False
    except FileNotFoundError:
        print("❌ OpenSSL not found. Please install OpenSSL or use a hosting service.")
        print("On Mac: brew install openssl")
        print("On Ubuntu: sudo apt-get install openssl")
        return False

def get_local_ip():
    """Get the local IP address"""
    try:
        # Connect to a remote server to determine local IP
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except:
        return "localhost"

def main():
    # Check if miniapp.html exists
    if not Path('miniapp.html').exists():
        print("❌ miniapp.html not found in current directory")
        print("Make sure you're running this script in the same directory as miniapp.html")
        return
    
    # Create SSL certificate
    if not create_self_signed_cert():
        print("❌ Failed to create SSL certificate. Exiting.")
        return
    
    # Set up HTTPS server
    PORT = 8443
    
    class HTTPSRequestHandler(http.server.SimpleHTTPRequestHandler):
        def end_headers(self):
            # Add CORS headers for mini app
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            super().end_headers()
        
        def log_message(self, format, *args):
            # Custom logging
            print(f"📱 {self.address_string()} - {format % args}")
    
    # Create server
    httpd = http.server.HTTPServer(('0.0.0.0', PORT), HTTPSRequestHandler)
    
    # Add SSL context
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain('server.crt', 'server.key')
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
    
    local_ip = get_local_ip()
    
    print("\n🚀 HTTPS Server starting...")
    print(f"📱 Mini App URL: https://localhost:{PORT}/miniapp.html")
    print(f"🌐 Network URL: https://{local_ip}:{PORT}/miniapp.html")
    print("\n📝 Update your bot code with one of these URLs:")
    print(f'   WebAppInfo(url="https://localhost:{PORT}/miniapp.html")')
    print(f'   WebAppInfo(url="https://{local_ip}:{PORT}/miniapp.html")')
    print("\n⚠️  Note: You'll need to accept the security warning in Telegram")
    print("    since this uses a self-signed certificate.")
    print("\n🛑 Press Ctrl+C to stop the server")
    print("-" * 60)
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n\n🛑 Server stopped")
        httpd.server_close()
        
        # Clean up certificate files
        try:
            os.remove('server.crt')
            os.remove('server.key')
            print("🧹 Cleaned up SSL certificate files")
        except:
            pass

if __name__ == "__main__":
    main() 