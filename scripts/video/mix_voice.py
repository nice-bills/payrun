# Lays the narration lines under the cut video: 30 ms fades, each line at its time, -16 LUFS.
#   python3 scripts/video/mix_voice.py <model dir> <video.mp4> <out.mp4>
import json, os, subprocess, sys
FF = os.environ.get("FFMPEG", "ffmpeg")
d, video, out = sys.argv[1:4]
L = json.load(open(f"{d}/lines.json"))
dur = float(subprocess.run([FF, "-i", video], capture_output=True, text=True).stderr.split("Duration: ")[1].split(",")[0].split(":")[-1]) + 60 * int(subprocess.run([FF, "-i", video], capture_output=True, text=True).stderr.split("Duration: ")[1].split(":")[1])
ins, fc, labs = [], [], []
for i, l in enumerate(L):
    ins += ["-i", l["file"]]; ms = int(l["start"] * 1000); t = l["dur"]
    fc.append(f"[{i}:a]afade=t=in:d=0.03,afade=t=out:st={max(t - 0.03, 0):.3f}:d=0.03,adelay={ms}|{ms},apad[a{i}]"); labs.append(f"[a{i}]")
fc.append("".join(labs) + f"amix=inputs={len(L)}:normalize=0:duration=longest,atrim=0:{dur:.2f},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[vo]")
subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", *ins, "-filter_complex", ";".join(fc), "-map", "[vo]", "-c:a", "pcm_s16le", f"{d}/vo.wav"], check=True)
subprocess.run([FF, "-hide_banner", "-loglevel", "error", "-y", "-i", video, "-i", f"{d}/vo.wav", "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", out], check=True)
print(out)
