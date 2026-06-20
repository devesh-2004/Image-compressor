"use client";

import imageCompression from "browser-image-compression";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";

const MAX_FILE_SIZE_MB = 20;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

type Status = "idle" | "compressing" | "done" | "error";
type Mode = "quality" | "size";

const SIZE_PRESETS_KB = [50, 100, 200];

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function extensionForType(type: string): string {
  switch (type) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "img";
  }
}

function downloadName(originalName: string, outputType: string): string {
  const dot = originalName.lastIndexOf(".");
  const base = dot > 0 ? originalName.slice(0, dot) : originalName;
  return `${base}-compressed.${extensionForType(outputType)}`;
}

export default function ImageCompressor() {
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);

  const [compressedFile, setCompressedFile] = useState<File | null>(null);
  const [compressedUrl, setCompressedUrl] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("quality");
  const [quality, setQuality] = useState(0.6);
  const [targetKB, setTargetKB] = useState(100);
  const [customKB, setCustomKB] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // Clean up object URLs to avoid memory leaks.
  useEffect(() => {
    return () => {
      if (originalUrl) URL.revokeObjectURL(originalUrl);
    };
  }, [originalUrl]);

  useEffect(() => {
    return () => {
      if (compressedUrl) URL.revokeObjectURL(compressedUrl);
    };
  }, [compressedUrl]);

  const acceptFile = useCallback((file: File) => {
    setError(null);

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setStatus("error");
      setError(
        "Unsupported file type. Please choose a JPG, PNG, or WebP image."
      );
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setStatus("error");
      setError(
        `That file is too large (${formatBytes(file.size)}). The maximum size is ${MAX_FILE_SIZE_MB} MB.`
      );
      return;
    }

    // Reset previous compressed result.
    setCompressedFile(null);
    setCompressedUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });

    setOriginalUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setOriginalFile(file);
    setStatus("idle");
  }, []);

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) acceptFile(file);
    // Allow re-selecting the same file later.
    e.target.value = "";
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) acceptFile(file);
  };

  // (Re)compress whenever a valid file is loaded or any setting changes.
  useEffect(() => {
    if (!originalFile) return;
    if (mode === "size" && (!targetKB || targetKB <= 0)) return;

    let cancelled = false;
    const handle = setTimeout(async () => {
      setStatus("compressing");
      setError(null);
      try {
        const options =
          mode === "size"
            ? {
                // Convert the KB target to MB for the library.
                maxSizeMB: targetKB / 1024,
                // The library shrinks dimensions + quality ~5% per iteration;
                // allow extra passes so small targets are actually reachable.
                maxIteration: 30,
                useWebWorker: true,
                fileType: originalFile.type,
              }
            : {
                initialQuality: quality,
                maxSizeMB: MAX_FILE_SIZE_MB,
                useWebWorker: true,
                fileType: originalFile.type,
              };
        const output = await imageCompression(originalFile, options);

        if (cancelled) return;

        setCompressedFile(output);
        setCompressedUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(output);
        });
        setStatus("done");
      } catch (err) {
        if (cancelled) return;
        console.error(err);
        setStatus("error");
        setError(
          "Something went wrong while compressing this image. Please try a different file."
        );
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [originalFile, quality, mode, targetKB]);

  const handleDownload = () => {
    if (!compressedFile || !compressedUrl || !originalFile) return;
    const a = document.createElement("a");
    a.href = compressedUrl;
    a.download = downloadName(originalFile.name, compressedFile.type);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const reset = () => {
    setOriginalFile(null);
    setOriginalUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setCompressedFile(null);
    setCompressedUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setStatus("idle");
    setError(null);
  };

  const reduction =
    originalFile && compressedFile
      ? Math.max(
          0,
          Math.round(
            (1 - compressedFile.size / originalFile.size) * 100
          )
        )
      : 0;

  const isCompressing = status === "compressing";

  const targetBytes = targetKB * 1024;
  const metTarget =
    mode === "size" && compressedFile
      ? compressedFile.size <= targetBytes
      : null;

  return (
    <div className="w-full max-w-3xl mx-auto">
      {/* Upload / dropzone */}
      {!originalFile && (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
          }}
          className={`group flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-6 py-16 text-center cursor-pointer transition-colors ${
            isDragging
              ? "border-indigo-500 bg-indigo-50"
              : "border-slate-300 bg-white hover:border-indigo-400 hover:bg-slate-50"
          }`}
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-100 text-indigo-600 transition-transform group-hover:scale-105">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.8}
              stroke="currentColor"
              className="h-7 w-7"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
              />
            </svg>
          </div>
          <div>
            <p className="text-lg font-semibold text-slate-800">
              Drag &amp; drop an image here
            </p>
            <p className="mt-1 text-sm text-slate-500">
              or <span className="text-indigo-600 font-medium">browse</span> to
              upload
            </p>
          </div>
          <p className="text-xs text-slate-400">
            JPG, PNG or WebP · up to {MAX_FILE_SIZE_MB} MB
          </p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={onInputChange}
      />

      {/* Error (shown even with no file loaded) */}
      {error && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="mt-0.5 h-5 w-5 shrink-0"
          >
            <path
              fillRule="evenodd"
              d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm8.706-1.442 1.146-.573a.75.75 0 0 1 1.058.813l-.737 3.686a.75.75 0 0 0 1.058.813l1.146-.573M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"
              clipRule="evenodd"
            />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* Workspace */}
      {originalFile && (
        <div className="space-y-6">
          {/* Previews */}
          <div className="grid gap-4 sm:grid-cols-2">
            <PreviewCard
              label="Original"
              url={originalUrl}
              size={originalFile.size}
              tone="slate"
            />
            <PreviewCard
              label="Compressed"
              url={compressedUrl}
              size={compressedFile?.size ?? null}
              tone="indigo"
              loading={isCompressing}
            />
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-center">
            <Stat label="Original" value={formatBytes(originalFile.size)} />
            <Stat
              label="Compressed"
              value={
                isCompressing || !compressedFile
                  ? "…"
                  : formatBytes(compressedFile.size)
              }
            />
            <Stat
              label="Reduction"
              value={
                isCompressing || !compressedFile ? "…" : `${reduction}%`
              }
              highlight
            />
          </div>

          {/* Controls */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            {/* Mode toggle */}
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
              <button
                onClick={() => setMode("quality")}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  mode === "quality"
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                By quality
              </button>
              <button
                onClick={() => setMode("size")}
                className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  mode === "size"
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                By target size
              </button>
            </div>

            {mode === "quality" ? (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <label
                    htmlFor="quality"
                    className="text-sm font-medium text-slate-700"
                  >
                    Compression level
                  </label>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                    Quality {Math.round(quality * 100)}%
                  </span>
                </div>
                <input
                  id="quality"
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={quality}
                  disabled={isCompressing}
                  onChange={(e) => setQuality(parseFloat(e.target.value))}
                  className="w-full"
                />
                <div className="mt-2 flex justify-between text-xs text-slate-400">
                  <span>Smaller file</span>
                  <span>Higher quality</span>
                </div>
              </>
            ) : (
              <>
                <p className="mb-3 text-sm font-medium text-slate-700">
                  Target maximum file size
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {SIZE_PRESETS_KB.map((kb) => {
                    const active = customKB === "" && targetKB === kb;
                    return (
                      <button
                        key={kb}
                        onClick={() => {
                          setCustomKB("");
                          setTargetKB(kb);
                        }}
                        disabled={isCompressing}
                        className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                          active
                            ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                            : "border-slate-300 bg-white text-slate-600 hover:border-indigo-400"
                        }`}
                      >
                        {kb} KB
                      </button>
                    );
                  })}
                  <div
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 transition-colors ${
                      customKB !== ""
                        ? "border-indigo-600 bg-indigo-50"
                        : "border-slate-300 bg-white"
                    }`}
                  >
                    <input
                      type="number"
                      min={1}
                      placeholder="Custom"
                      value={customKB}
                      disabled={isCompressing}
                      onChange={(e) => {
                        const v = e.target.value;
                        setCustomKB(v);
                        const n = parseInt(v, 10);
                        if (!Number.isNaN(n) && n > 0) setTargetKB(n);
                      }}
                      className="w-20 bg-transparent text-sm font-semibold text-slate-700 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <span className="text-sm font-medium text-slate-400">KB</span>
                  </div>
                </div>

                {/* Confirmation that the result is under the target */}
                {compressedFile && !isCompressing && (
                  <div
                    className={`mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
                      metTarget
                        ? "bg-green-50 text-green-700"
                        : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {metTarget ? (
                      <>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className="h-4 w-4 shrink-0"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                            clipRule="evenodd"
                          />
                        </svg>
                        {formatBytes(compressedFile.size)} — under your{" "}
                        {targetKB} KB target
                      </>
                    ) : (
                      <>
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className="h-4 w-4 shrink-0"
                        >
                          <path
                            fillRule="evenodd"
                            d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.515 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
                            clipRule="evenodd"
                          />
                        </svg>
                        Smallest possible is {formatBytes(compressedFile.size)} —
                        couldn&apos;t reach {targetKB} KB without losing the image.
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              onClick={handleDownload}
              disabled={!compressedFile || isCompressing}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCompressing ? (
                <>
                  <Spinner />
                  Compressing…
                </>
              ) : (
                <>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                    className="h-5 w-5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
                    />
                  </svg>
                  Download compressed
                </>
              )}
            </button>
            <button
              onClick={reset}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              Choose another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewCard({
  label,
  url,
  size,
  tone,
  loading = false,
}: {
  label: string;
  url: string | null;
  size: number | null;
  tone: "slate" | "indigo";
  loading?: boolean;
}) {
  const badge =
    tone === "indigo"
      ? "bg-indigo-100 text-indigo-700"
      : "bg-slate-100 text-slate-600";

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${badge}`}>
          {label}
        </span>
        {size != null && (
          <span className="text-xs font-medium text-slate-500">
            {formatBytes(size)}
          </span>
        )}
      </div>
      <div className="relative flex aspect-video items-center justify-center bg-[repeating-conic-gradient(#f1f5f9_0_25%,#ffffff_0_50%)] bg-[length:20px_20px]">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={label}
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="text-xs text-slate-400">Waiting…</span>
        )}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-sm">
            <Spinner className="h-6 w-6 text-indigo-600" />
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p
        className={`mt-1 text-lg font-bold tabular-nums ${
          highlight ? "text-indigo-600" : "text-slate-800"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
