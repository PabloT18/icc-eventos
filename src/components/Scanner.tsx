"use client";
import { useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
export default function Scanner({
  onRead,
}: {
  onRead: (text: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const controls = useRef<IScannerControls | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    let found = false;
    const reader = new BrowserQRCodeReader();
    reader
      .decodeFromConstraints(
        { video: { facingMode: "environment" }, audio: false },
        video.current!,
        (result, _error, c) => {
          if (result && !found && !disposed) {
            found = true;
            c.stop();
            onRead(result.getText());
          }
        },
      )
      .then((c) => {
        if (disposed || found) c.stop();
        else controls.current = c;
      })
      .catch(() => {
        if (!disposed)
          setError(
            "No se pudo abrir la cámara. Revise el permiso y utilice HTTPS.",
          );
      });
    return () => {
      disposed = true;
      controls.current?.stop();
    };
  }, [onRead]);
  return (
    <>
      <video ref={video} muted playsInline />
      {error && <p role="alert">{error}</p>}
    </>
  );
}
