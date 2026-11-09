import { notFound } from "next/navigation";

import { VisionOcrWorkspace } from "@/features/vision-ocr/components/vision-ocr-workspace";
import { getPublicEnvironment } from "@/lib/env";

export default function VisionOcrPage() {
  if (!["DEV", "PROD"].includes(getPublicEnvironment().appEnvironment)) notFound();
  return <VisionOcrWorkspace />;
}
