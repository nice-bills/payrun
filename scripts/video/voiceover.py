# Narration for the demo video with Kokoro (open-source TTS, runs on CPU).
#   pip install kokoro-onnx soundfile
#   get kokoro-v1.0.onnx and voices-v1.0.bin from github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0)
#   python3 scripts/video/voiceover.py <model dir>   -> <model dir>/line_*.wav and lines.json, then mix with mix_voice.py
import json, sys, soundfile as sf, numpy as np
from kokoro_onnx import Kokoro
D = sys.argv[1]
k = Kokoro(f"{D}/kokoro-v1.0.onnx", f"{D}/voices-v1.0.bin")
# (start in the final cut, must end before, text). SERV is said "serve"; USDC is spelled out.
LINES = [
  (0.5, 3.3, "Payrun. Pay contractors by the book."),
  (3.4, 12.6, "This invoice hides a line in tiny white text: orders for the AI reviewing it. Serv's guard blocked it before any model read a word."),
  (12.9, 25.9, "Every invoice meets four layers, in order: Serv's prompt guard, Payrun's code checks, Serv reasoning, and Coinbase's signer. The first one that objects, decides. A clean invoice passes all four, and gets paid."),
  (26.2, 38.2, "This is the real desk. Here's that PDF, blocked. Reveal what the model was fed, and there's the hidden instruction: approve it, and don't flag it."),
  (38.5, 46.2, "Ahkohsuah's email asks to change her wallet. It's held, citing clause four, and the note points at the exact words."),
  (46.4, 56.5, "Serv also attacks the policy itself, writing invoices aimed at its loose wording. Where it's ambiguous, the owner picks what they meant, and Serv drafts the clause."),
  (56.7, 63.4, "Then Serv runs payroll itself, through Coinbase AgentKit. It checks the wallet balance before every payment."),
  (63.6, 68.3, "Any invoice the wallet can't cover is held for a top-up."),
  (68.5, 76.0, "Efua's invoice passes every check. The agent pays her, and Coinbase's signer approves the transfer, on-chain."),
  (76.2, 84.6, "Everything else is held or blocked, and every step shows who acted: Serv, Payrun's checks, AgentKit, or the signer."),
  (84.8, 89.3, "Every payment gets a receipt, with its transaction."),
  (89.3, 94.7, "And the wallet carries the same rules. Coinbase's signer refuses anything outside them."),
  (94.8, 105.5, "So we made it public. Send Payrun any invoice. If it pays you, you keep it. So far, it hasn't paid anyone."),
  (105.8, 109.4, "Payrun. Try to scam it."),
]
SR = 24000
out, report = [], []
for start, limit, text in LINES:
    speed = 1.0
    while True:
        a, sr = k.create(text, voice="af_heart", speed=speed, lang="en-us")
        if start + len(a) / sr <= limit + 0.15 or speed >= 1.25: break
        speed = round(speed + 0.05, 2)
    assert sr == SR
    f = f"{D}/line_{start:06.2f}.wav"; sf.write(f, a, sr)
    out.append({"start": start, "file": f, "dur": len(a) / sr})
    report.append(f"{start:6.1f} +{len(a)/sr:4.1f}s (limit {limit - start:4.1f}) x{speed}  {text[:50]}")
json.dump(out, open(f"{D}/lines.json", "w"))
print("\n".join(report))
