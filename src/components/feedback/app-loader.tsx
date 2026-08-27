"use client";

import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { useEffect, useState } from "react";

export function AppLoader({
  label = "Cargando información…",
  delay = 180,
  fullScreen = false,
}: {
  label?: string;
  delay?: number;
  fullScreen?: boolean;
}) {
  const [visible, setVisible] = useState(delay === 0);

  useEffect(() => {
    if (delay === 0) return;
    const timer = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(timer);
  }, [delay]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className={`grid place-items-center bg-canvas ${
            fullScreen ? "fixed inset-0 z-[100] min-h-screen" : "min-h-[55vh]"
          }`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="status"
          aria-live="polite"
        >
          <div className="text-center">
            <motion.div
              className="mx-auto grid size-24 place-items-center rounded-2xl border border-white/8 bg-sidebar shadow-sm"
              animate={{ scale: [1, 1.025, 1] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            >
              <Image
                src="/pro-logo.png"
                alt=""
                width={126}
                height={63}
                className="h-auto w-20"
                priority
              />
            </motion.div>
            <motion.p
              className="mt-5 text-sm font-medium text-foreground-muted"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 }}
            >
              {label}
            </motion.p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function PageLoader({ label }: { label?: string }) {
  return <AppLoader label={label} />;
}
