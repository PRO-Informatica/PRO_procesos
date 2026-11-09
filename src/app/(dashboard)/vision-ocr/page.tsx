import { notFound } from "next/navigation";

import { VisionOcrWorkspace } from "@/features/vision-ocr/components/vision-ocr-workspace";
import { getPublicEnvironment } from "@/lib/env";

export default function VisionOcrPage() {
  if (getPublicEnvironment().appEnvironment !== "DEV") notFound();
  return <VisionOcrWorkspace />;
}
