"""Pre-record the fixed voice lines in scripts/voice-lines.json as MP3s with natural
Microsoft neural voices (via edge-tts), and write public/voice/manifest.json.

Usage:  pip install edge-tts   then   python scripts/gen-voices.py
"""
import asyncio, hashlib, json, pathlib, re
import edge_tts

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "voice"
EMOJI = re.compile(r"[\U0001F000-\U0001FAFF\u2600-\u27BF]")

def file_id(text):
    return hashlib.md5(text.encode("utf-8")).hexdigest()[:12]

async def main():
    lines = json.loads((ROOT / "scripts" / "voice-lines.json").read_text(encoding="utf-8"))["lines"]
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for line in lines:
        name = f"{file_id(line['text'])}.mp3"
        target = OUT / name
        if not target.exists():
            speak = EMOJI.sub("", line.get("speak", line["text"])).strip()
            tts = edge_tts.Communicate(speak, line["voice"], rate=line.get("rate", "-5%"), pitch=line.get("pitch", "+0Hz"))
            await tts.save(str(target))
            print("recorded", name, line["text"])
        manifest[line["text"]] = name
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(len(manifest), "lines in manifest")

asyncio.run(main())
