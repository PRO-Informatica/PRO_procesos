export type GlobalReconciliationItem = {
  id: string;
  dispatchId: string;
  programmingCode: string;
  batchId: string;
  batchCode: string;
  orderNumber: string;
  supplierName: string;
  realVolume: number;
  unitCode: string;
  invoiceCount: number;
  hasProductInvoice: boolean;
  hasServiceInvoice: boolean;
  reconciliationStatus: string;
  difference: number | null;
};
export type GlobalReconciliationData = {
  items: GlobalReconciliationItem[];
  batches: Array<{ id: string; code: string }>;
};
