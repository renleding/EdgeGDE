"""One-shot verification of live HAR streaming (reads the running daemon's stream)."""
import asyncio, glob, os, time, tempfile
from pathlib import Path
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mitmproxy_client import MitmproxyClient


async def main():
    stream = None
    for d in sorted(glob.glob(tempfile.gettempdir() + '/mitmproxy-har-*'),
                    key=os.path.getmtime, reverse=True):
        sf = os.path.join(d, 'stream.jsonl')
        if os.path.exists(sf):
            stream = sf
            break
    if not stream:
        print('NO STREAM FOUND')
        return 1
    print('STREAM:', stream)

    client = MitmproxyClient()
    client._stream_file = Path(stream)
    client._started = True

    entries = []
    deadline = time.time() + 10
    while time.time() < deadline and not entries:
        try:
            agen = client.har()
            e = await asyncio.wait_for(agen.__anext__(), timeout=5)
            entries.append(e)
            await agen.aclose()
        except StopAsyncIteration:
            pass
        except asyncio.TimeoutError:
            pass
        await asyncio.sleep(0.3)

    print('ENTRIES:', len(entries))
    for e in entries:
        print('  ', e['request']['method'], e['request']['url'][:60],
              'frame=', e.get('_cdp_frame_id'))
    print('CORRELATE TEST-LIVE:', len(client.correlate('TEST-LIVE')))
    print('SUMMARY:', client.get_har_summary())
    return 0 if entries else 1


sys.exit(asyncio.run(main()))