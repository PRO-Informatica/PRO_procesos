export type GlobalReconciliationItem = {
  id: string; batchId: string; batchCode: string; orderNumber: string; supplierName: string;
  guideCount: number; invoiceCount: number; documentStatus: string; reconciliationStatus: string;
  difference: number; differenceUnits: string[];
};
export type GlobalReconciliationData = { items: GlobalReconciliationItem[]; batches: Array<{ id: string; code: string }> };
