import os
import requests

# Get credentials from environment
api_token = os.environ.get('CLOUDFLARE_API_TOKEN')
account_id = os.environ.get('CLOUDFLARE_ACCOUNT_ID')
zone_id = os.environ.get('CLOUDFLARE_ZONE_ID')

if not all([api_token, account_id, zone_id]):
    print("Missing Cloudflare credentials in environment")
    exit(1)

# Purge cache for the configurator path
url = f"https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache"
headers = {
    "Authorization": f"Bearer {api_token}",
    "Content-Type": "application/json"
}
data = {
    "files": [
        "https://auto.afirmi.co/admin/telemetry/configurator"
    ]
}

response = requests.post(url, headers=headers, json=data)
print(response.status_code, response.json())
