# Cuts a take from record.mjs into one video: a clip per shot, 0.35 s crossfades, H.264 1080p.
import json, subprocess, sys, os
FF = os.environ.get("FFMPEG", "ffmpeg")
take, out = sys.argv[1], sys.argv[2]
t = json.load(open(f"{take}/timeline.json"))
frames = t["frames"]; XF = 0.35
os.makedirs(f"{take}/seg", exist_ok=True)
segs = []
for i, s in enumerate(t["shots"]):
    # the frame on screen at the shot start, then every frame inside it
    before = [f for f in frames if f["t"] <= s["start"]]
    inside = [f for f in frames if s["start"] < f["t"] < s["end"]]
    fs = ([dict(before[-1], t=s["start"])] if before else []) + inside
    lines = ["ffconcat version 1.0"]
    for a, b in zip(fs, fs[1:] + [{"t": s["end"]}]):
        lines += [f"file '{a['file']}'", f"duration {max(b['t'] - a['t'], 0.001):.4f}"]
    lines.append(f"file '{fs[-1]['file']}'")
    lst = f"{take}/seg/{i:02d}.txt"; open(lst, "w").write("\n".join(lines) + "\n")
    mp4 = f"{take}/seg/{i:02d}-{s['name']}.mp4"
    subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", lst,
                    "-vf", "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "18", mp4], check=True)
    segs.append((mp4, s["end"] - s["start"], s["name"]))
# crossfade chain
inputs, fc, prev, off = [], [], "[0:v]", 0.0
for i, (mp4, d, _) in enumerate(segs):
    inputs += ["-i", mp4]
for i in range(1, len(segs)):
    off += segs[i - 1][1] - XF
    lab = f"[v{i}]"
    fc.append(f"{prev}[{i}:v]xfade=transition=fade:duration={XF}:offset={off:.3f}{lab}")
    prev = lab
subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", *inputs, "-filter_complex", ";".join(fc), "-map", prev,
                "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-r", "30", out], check=True)
# where each cut lands in the final video, for the self-check
t0, marks = 0.0, []
for mp4, d, name in segs:
    marks.append((name, round(t0, 2), round(t0 + d, 2))); t0 += d - XF
json.dump(marks, open(f"{take}/marks.json", "w"))
print(marks)
