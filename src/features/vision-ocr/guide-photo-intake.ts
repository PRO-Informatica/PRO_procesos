type PhotoTransfer = {
  files?: ArrayLike<File>;
  items?: ArrayLike<Pick<DataTransferItem, "kind" | "getAsFile">>;
};

// Browsers can expose the same clipboard image through both lists. Read only
// one representation, and leave ordinary text/HTML pastes to their field.
export function clipboardGuideImages(transfer: PhotoTransfer): File[] {
  const files = Array.from(transfer.files ?? []).filter((file) => file.type.startsWith("image/"));
  if (files.length) return files;
  return Array.from(transfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file?.type.startsWith("image/")));
}
