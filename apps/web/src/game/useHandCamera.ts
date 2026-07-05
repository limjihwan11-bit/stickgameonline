import { useCallback, useEffect, useRef, useState } from "react";
import type { HandLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";

export interface TrackedHand { hand: 0|1; x: number; y: number; fingers: number; vx: number; vy: number; speed: number; landmarks: NormalizedLandmark[] }
export type CameraStatus = "idle" | "loading" | "running" | "denied" | "error";

export function countFingers(points: NormalizedLandmark[], handedness: string): number {
  if (points.length < 21) return 0;
  let count = 0;
  [[8,6],[12,10],[16,14],[20,18]].forEach(([tip,pip]) => { if (points[tip].y < points[pip].y - .025) count++; });
  const thumb = handedness === "Left" ? points[4].x < points[3].x - .025 : points[4].x > points[3].x + .025;
  return count + Number(thumb);
}

function majority(values: number[]): number {
  const counts = new Map<number,number>(); values.forEach(v => counts.set(v,(counts.get(v)||0)+1));
  return [...counts].sort((a,b)=>b[1]-a[1])[0]?.[0] ?? 0;
}

export function calculateMotion(previous: {x:number;y:number;time:number}|undefined, current: {x:number;y:number}, time: number) {
  if (!previous) return { vx: 0, vy: 0, speed: 0 };
  const seconds = Math.max((time - previous.time) / 1000, .016);
  const vx = (current.x - previous.x) / seconds; const vy = (current.y - previous.y) / seconds;
  return { vx, vy, speed: Math.hypot(vx, vy) };
}

export function isUpwardStrike(motion: Pick<TrackedHand, "speed" | "vy">, armed: boolean) {
  return armed && motion.speed > .72 && motion.vy < -.28;
}

export function useHandCamera() {
  const videoRef = useRef<HTMLVideoElement>(null); const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<CameraStatus>("idle"); const [hands, setHands] = useState<TrackedHand[]>([]);
  const landmarkerRef = useRef<HandLandmarker|null>(null); const streamRef = useRef<MediaStream|null>(null); const frameRef = useRef(0); const histories = useRef<Record<number,number[]>>({0:[],1:[]});
  const previousPositions = useRef<Partial<Record<0|1,{x:number;y:number;time:number}>>>({});

  const stop = useCallback(() => {
    cancelAnimationFrame(frameRef.current); streamRef.current?.getTracks().forEach(t=>t.stop()); streamRef.current=null;
    if (videoRef.current) videoRef.current.srcObject=null; setHands([]); setStatus("idle");
  },[]);

  const start = useCallback(async () => {
    if (status === "running") return stop();
    try {
      setStatus("loading");
      if (!landmarkerRef.current) {
        const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm");
        landmarkerRef.current = await HandLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:"https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",delegate:"GPU"},runningMode:"VIDEO",numHands:2,minHandDetectionConfidence:.55,minHandPresenceConfidence:.5,minTrackingConfidence:.5});
      }
      const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:960},height:{ideal:720}},audio:false}); streamRef.current=stream;
      const video=videoRef.current!; video.srcObject=stream; await video.play(); setStatus("running");
      let lastTime=-1; let lastEmit=0;
      const detect=()=>{
        if(!streamRef.current||!landmarkerRef.current)return;
        const now=performance.now();
        if(video.readyState>=2&&video.currentTime!==lastTime&&now-lastEmit>65){
          lastTime=video.currentTime; lastEmit=now; const result=landmarkerRef.current.detectForVideo(video,now);
          const tracked:TrackedHand[]=result.landmarks.map((points,i)=>{
            const x=1-points[0].x; const hand:(0|1)=x<.5?0:1; const raw=countFingers(points,result.handednesses[i]?.[0]?.categoryName||"Right");
            const history=histories.current[hand]; history.push(raw); if(history.length>8)history.shift();
            const y=points[0].y; const motion=calculateMotion(previousPositions.current[hand],{x,y},now); previousPositions.current[hand]={x,y,time:now};
            return {hand,x,y,fingers:majority(history),...motion,landmarks:points};
          });
          setHands(tracked);
          const canvas=canvasRef.current;
          if(canvas){const rect=canvas.getBoundingClientRect();canvas.width=rect.width;canvas.height=rect.height;const ctx=canvas.getContext("2d")!;ctx.clearRect(0,0,canvas.width,canvas.height);tracked.forEach(h=>{ctx.fillStyle="#ff7a4f";h.landmarks.forEach(p=>{ctx.beginPath();ctx.arc((1-p.x)*canvas.width,p.y*canvas.height,2.5,0,Math.PI*2);ctx.fill();});});}
        }
        frameRef.current=requestAnimationFrame(detect);
      }; detect();
    } catch(error){console.error(error);setStatus(error instanceof DOMException&&error.name==="NotAllowedError"?"denied":"error");streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null;}
  },[status,stop]);
  useEffect(()=>()=>{cancelAnimationFrame(frameRef.current);streamRef.current?.getTracks().forEach(t=>t.stop());landmarkerRef.current?.close();},[]);
  return {videoRef,canvasRef,status,hands,start,stop};
}
