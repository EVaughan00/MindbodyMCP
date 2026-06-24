import { mindbodyClient } from '../api/client.js';

// Get available services (class packages, memberships)
export async function getServicesTool(
  programIds?: number[],
  sessionTypeIds?: number[],
  locationId?: number,
  classId?: number,
  hideRelatedPrograms: boolean = false
): Promise<{
  services: Array<{
    id: number;
    name: string;
    price: number;
    onlinePrice?: number;
    taxIncluded: boolean;
    taxRate?: number;
    programId?: number;
    sessionTypeId?: number;
    count?: number;
    expirationUnit?: string;
    expirationLength?: number;
    membershipId?: number;
    priority?: number;
    prerequisite?: string;
    isIntroOffer: boolean;
    introOfferType?: string;
  }>;
  totalServices: number;
}> {
  const response = await mindbodyClient.get<any>('/sale/services', {
    params: {
      ProgramIds: programIds,
      SessionTypeIds: sessionTypeIds,
      LocationId: locationId,
      ClassId: classId,
      HideRelatedPrograms: hideRelatedPrograms,
      Limit: 200,
    },
  });

  const services = response.Services.map((service: any) => ({
    id: service.Id,
    name: service.Name,
    price: service.Price,
    onlinePrice: service.OnlinePrice,
    taxIncluded: service.TaxIncluded,
    taxRate: service.TaxRate,
    programId: service.ProgramId,
    sessionTypeId: service.SessionTypeId,
    count: service.Count,
    expirationUnit: service.ExpirationUnit,
    expirationLength: service.ExpirationLength,
    membershipId: service.MembershipId,
    priority: service.Priority,
    prerequisite: service.Prerequisite,
    // Required to identify trial/intro offers — never guess by name.
    isIntroOffer: !!service.IsIntroOffer,
    introOfferType: service.IntroOfferType,
  }));

  return {
    services,
    totalServices: services.length,
  };
}

// Get packages (class packages)
export async function getPackagesTool(
  locationId?: number,
  classScheduleId?: number
): Promise<{
  packages: Array<{
    id: number;
    name: string;
    classCount: number;
    price: number;
    onlinePrice?: number;
    taxIncluded: boolean;
    active: boolean;
    productId?: number;
    sellOnline: boolean;
    services?: Array<{ id: number; name: string; count: number }>;
  }>;
  totalPackages: number;
}> {
  const response = await mindbodyClient.get<any>('/sale/packages', {
    params: {
      LocationId: locationId,
      ClassScheduleId: classScheduleId,
      Limit: 200,
    },
  });

  const packages = response.Packages.map((pkg: any) => ({
    id: pkg.Id,
    name: pkg.Name,
    classCount: pkg.Count,
    price: pkg.Price,
    onlinePrice: pkg.OnlinePrice,
    taxIncluded: pkg.TaxIncluded,
    active: pkg.Active,
    productId: pkg.ProductId,
    sellOnline: pkg.SellOnline,
    services: pkg.Services?.map((s: any) => ({
      id: s.Id,
      name: s.Name,
      count: s.Count,
    })),
  }));

  return {
    packages,
    totalPackages: packages.length,
  };
}

// Get products (retail items, equipment)
export async function getProductsTool(
  productIds?: number[],
  searchText?: string,
  categoryIds?: string[],
  subCategoryIds?: string[],
  sellOnline?: boolean
): Promise<{
  products: Array<{
    id: string;
    name: string;
    price: number;
    onlinePrice?: number;
    description?: string;
    category?: string;
    subCategory?: string;
    color?: string;
    size?: string;
    taxIncluded: boolean;
    taxRate?: number;
    sellOnline: boolean;
  }>;
  totalProducts: number;
}> {
  const response = await mindbodyClient.get<any>('/sale/products', {
    params: {
      ProductIds: productIds,
      SearchText: searchText,
      CategoryIds: categoryIds,
      SubCategoryIds: subCategoryIds,
      SellOnline: sellOnline,
      Limit: 200,
    },
  });

  const products = response.Products.map((product: any) => ({
    id: product.Id,
    name: product.Name,
    price: product.Price,
    onlinePrice: product.OnlinePrice,
    description: product.Description,
    category: product.Category,
    subCategory: product.Subcategory,
    color: product.Color?.Name,
    size: product.Size?.Name,
    taxIncluded: product.TaxIncluded,
    taxRate: product.TaxRate,
    sellOnline: product.SellOnline,
  }));

  return {
    products,
    totalProducts: response.PaginationResponse.TotalResults,
  };
}

// Checkout shopping cart
export async function checkoutShoppingCartTool(
  clientId: string,
  items: Array<{
    item: {
      type: 'Service' | 'Product' | 'Package' | 'Tip';
      metadata: {
        id: number;
        name?: string;
        amount?: number; // For tips
      };
    };
    quantity: number;
    appointmentBookingRequests?: Array<{
      staffId: number;
      locationId: number;
      sessionTypeId: number;
      startDateTime: string;
      notes?: string;
    }>;
  }>,
  payments: Array<{
    type: 'Cash' | 'Check' | 'CreditCard' | 'Comp' | 'Custom' | 'StoredCard';
    metadata: {
      amount: number;
      notes?: string;
      lastFour?: string; // For stored cards
      cardholderName?: string;
      billingAddress?: string;
      billingCity?: string;
      billingState?: string;
      billingPostalCode?: string;
    };
  }>,
  inStore: boolean = false,
  promotionCode?: string,
  sendEmail: boolean = true,
  locationId?: number
): Promise<{
  success: boolean;
  shoppingCart?: {
    id: string;
    subTotal: number;
    taxTotal: number;
    discountTotal: number;
    grandTotal: number;
    items: Array<{
      id: number;
      name: string;
      price: number;
      quantity: number;
      discountAmount: number;
      tax: number;
      total: number;
    }>;
  };
  appointments?: Array<{
    id: number;
    status: string;
    startDateTime: string;
    endDateTime: string;
    notes?: string;
  }>;
  message: string;
}> {
  try {
    // Map items to API format
    const cartItems = items.map(item => {
      const baseItem: any = {
        Quantity: item.quantity,
      };

      if (item.item.type === 'Service') {
        baseItem.Item = {
          Type: 'Service',
          Metadata: {
            Id: item.item.metadata.id,
          },
        };
      } else if (item.item.type === 'Product') {
        baseItem.Item = {
          Type: 'Product',
          Metadata: {
            Id: item.item.metadata.id,
          },
        };
      } else if (item.item.type === 'Package') {
        baseItem.Item = {
          Type: 'Package',
          Metadata: {
            Id: item.item.metadata.id,
          },
        };
      } else if (item.item.type === 'Tip') {
        baseItem.Item = {
          Type: 'Tip',
          Metadata: {
            Amount: item.item.metadata.amount,
          },
        };
      }

      if (item.appointmentBookingRequests) {
        baseItem.AppointmentBookingRequests = item.appointmentBookingRequests.map(apt => ({
          StaffId: apt.staffId,
          LocationId: apt.locationId,
          SessionTypeId: apt.sessionTypeId,
          StartDateTime: apt.startDateTime,
          Notes: apt.notes,
        }));
      }

      return baseItem;
    });

    // Map payments to API format
    const paymentMethods = payments.map(payment => {
      const basePayment: any = {
        Type: payment.type,
        Metadata: {
          Amount: payment.metadata.amount,
        },
      };

      if (payment.metadata.notes) {
        basePayment.Metadata.Notes = payment.metadata.notes;
      }

      if (payment.type === 'StoredCard' && payment.metadata.lastFour) {
        basePayment.Metadata.LastFour = payment.metadata.lastFour;
      }

      if (payment.type === 'CreditCard') {
        if (payment.metadata.cardholderName) {
          basePayment.Metadata.CardholderName = payment.metadata.cardholderName;
        }
        if (payment.metadata.billingAddress) {
          basePayment.Metadata.BillingAddress = payment.metadata.billingAddress;
          basePayment.Metadata.BillingCity = payment.metadata.billingCity;
          basePayment.Metadata.BillingState = payment.metadata.billingState;
          basePayment.Metadata.BillingPostalCode = payment.metadata.billingPostalCode;
        }
      }

      return basePayment;
    });

    const response = await mindbodyClient.post<any>('/sale/checkoutshoppingcart', {
      ClientId: clientId,
      Items: cartItems,
      Payments: paymentMethods,
      InStore: inStore,
      PromotionCode: promotionCode,
      SendEmail: sendEmail,
      LocationId: locationId,
    });

    return {
      success: true,
      shoppingCart: response.ShoppingCart ? {
        id: response.ShoppingCart.Id,
        subTotal: response.ShoppingCart.SubTotal,
        taxTotal: response.ShoppingCart.TaxTotal,
        discountTotal: response.ShoppingCart.DiscountTotal,
        grandTotal: response.ShoppingCart.GrandTotal,
        items: response.ShoppingCart.CartItems.map((item: any) => ({
          id: item.Id,
          name: item.Name,
          price: item.UnitPrice,
          quantity: item.Quantity,
          discountAmount: item.DiscountAmount,
          tax: item.TaxAmount,
          total: item.Total,
        })),
      } : undefined,
      appointments: response.Appointments?.map((apt: any) => ({
        id: apt.Id,
        status: apt.Status,
        startDateTime: apt.StartDateTime,
        endDateTime: apt.EndDateTime,
        notes: apt.Notes,
      })),
      message: 'Checkout completed successfully',
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.message || 'Failed to checkout',
    };
  }
}

// Purchase contract (membership/auto-renew)
export async function purchaseContractTool(
  clientId: string,
  contractId: number,
  startDate: string,
  firstPaymentOccurs?: 'StartDate' | 'UponSale' | 'BillingDate',
  clientSignature?: string,
  promotionCode?: string,
  locationId?: number
): Promise<{
  success: boolean;
  clientContract?: {
    id: number;
    clientId: string;
    contractName: string;
    startDate: string;
    endDate?: string;
    paymentAmount: number;
    frequency?: number;
    remainingPayments?: number;
  };
  message: string;
}> {
  try {
    const response = await mindbodyClient.post<any>('/sale/purchasecontract', {
      ClientId: clientId,
      ContractId: contractId,
      StartDate: startDate,
      FirstPaymentOccurs: firstPaymentOccurs || 'StartDate',
      ClientSignature: clientSignature,
      PromotionCode: promotionCode,
      LocationId: locationId,
    });

    return {
      success: true,
      clientContract: {
        id: response.ClientContract.Id,
        clientId: response.ClientContract.ClientId,
        contractName: response.ClientContract.ContractName,
        startDate: response.ClientContract.StartDate,
        endDate: response.ClientContract.EndDate,
        paymentAmount: response.ClientContract.PaymentAmount,
        frequency: response.ClientContract.Frequency,
        remainingPayments: response.ClientContract.RemainingPayments,
      },
      message: 'Contract purchased successfully',
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.message || 'Failed to purchase contract',
    };
  }
}

// Get contracts (membership types)
export async function getContractsTool(
  contractIds?: number[],
  soldOnline?: boolean,
  locationId?: number
): Promise<{
  contracts: Array<{
    id: number;
    name: string;
    description?: string;
    assignsMembershipId?: number;
    assignsMembershipName?: string;
    soldOnline: boolean;
    contractType: string;
    agreementTerms?: string;
    autopaySchedule?: {
      frequency: string;
      duration?: number;
      paymentAmount: number;
    };
    introOffer?: {
      id: string;
      name: string;
      price: number;
    };
    locationId?: number;
  }>;
  totalContracts: number;
}> {
  const response = await mindbodyClient.get<any>('/sale/contracts', {
    params: {
      ContractIds: contractIds,
      SoldOnline: soldOnline,
      LocationId: locationId,
      Limit: 200,
    },
  });

  const contracts = response.Contracts.map((contract: any) => ({
    id: contract.Id,
    name: contract.Name,
    description: contract.Description,
    assignsMembershipId: contract.AssignsMembershipId,
    assignsMembershipName: contract.AssignsMembershipName,
    soldOnline: contract.SoldOnline,
    contractType: contract.ContractType,
    agreementTerms: contract.AgreementTerms,
    autopaySchedule: contract.AutopaySchedule ? {
      frequency: contract.AutopaySchedule.FrequencyType,
      duration: contract.AutopaySchedule.FrequencyValue,
      paymentAmount: contract.AutopaySchedule.PaymentAmount,
    } : undefined,
    introOffer: contract.IntroOffer ? {
      id: contract.IntroOffer.Id,
      name: contract.IntroOffer.Name,
      price: contract.IntroOffer.Price,
    } : undefined,
    locationId: contract.LocationId,
  }));

  return {
    contracts,
    totalContracts: contracts.length,
  };
}

// --- Revenue ---------------------------------------------------------------

const RECURRING_PATTERNS = /contract|membership|autopay|auto-pay|recurring|monthly|unlimited|emi|installment/i;
const MAX_PAGES = 20; // safety cap on pagination (4000 records at 200/page)

// /sale/transactions ignores date-only values and defaults to "today"; it
// requires a full datetime. Normalize bare dates to a full-day ISO range.
function toStartDateTime(d: string): string {
  return d.includes('T') ? d : `${d}T00:00:00Z`;
}
function toEndDateTime(d: string): string {
  return d.includes('T') ? d : `${d}T23:59:59Z`;
}

/** Classify a purchased item as recurring revenue (contract/autopay membership) vs not. */
function isRecurringItem(item: any): boolean {
  if (item?.IsContract === true || item?.AutopayStatus) return true;
  const text = `${item?.Description ?? ''} ${item?.Name ?? ''}`;
  return RECURRING_PATTERNS.test(text);
}

/** Best-effort per-item amount (sales payments aren't itemized in every account). */
function itemAmount(item: any): number {
  if (typeof item?.TotalAmount === 'number') return item.TotalAmount;
  if (typeof item?.AmountPaid === 'number') return item.AmountPaid;
  if (typeof item?.Price === 'number') return item.Price * (item?.Quantity || 1);
  return 0;
}

async function fetchAllSales(startDate: string, endDate: string): Promise<{ sales: any[]; total: number; truncated: boolean }> {
  const sales: any[] = [];
  let offset = 0;
  let total = 0;
  let truncated = false;
  for (let i = 0; i < MAX_PAGES; i++) {
    const resp = await mindbodyClient.get<any>('/sale/sales', {
      params: { StartSaleDateTime: startDate, EndSaleDateTime: endDate, Limit: 200, Offset: offset },
    });
    const batch = resp.Sales || [];
    sales.push(...batch);
    total = resp.PaginationResponse?.TotalResults ?? sales.length;
    offset += batch.length;
    if (batch.length === 0 || offset >= total) break;
    if (i === MAX_PAGES - 1 && offset < total) truncated = true;
  }
  return { sales, total, truncated };
}

// Get raw sales in a window (gross sale value + what sold). Bounded + enveloped.
export async function getSalesTool(
  startDate: string,
  endDate: string,
  pageSize: number = 200
): Promise<{
  sales: Array<{
    id: number;
    saleDate: string;
    clientId?: string;
    locationId?: number;
    total: number;
    items: string[];
  }>;
  page: { returned: number; totalMatching: number; hasMore: boolean };
}> {
  const resp = await mindbodyClient.get<any>('/sale/sales', {
    params: { StartSaleDateTime: startDate, EndSaleDateTime: endDate, Limit: Math.min(pageSize, 200) },
  });
  const raw = resp.Sales || [];
  const total = resp.PaginationResponse?.TotalResults ?? raw.length;
  const sales = raw.map((s: any) => ({
    id: s.Id,
    saleDate: s.SaleDateTime ?? s.SaleDate,
    clientId: s.ClientId,
    locationId: s.LocationId,
    total: (s.Payments || []).reduce((sum: number, p: any) => sum + (p.Amount || 0), 0),
    items: (s.PurchasedItems || []).map((it: any) => it.Description ?? it.Name).filter(Boolean),
  }));
  return {
    sales,
    page: { returned: sales.length, totalMatching: total, hasMore: sales.length < total },
  };
}

// Get raw transactions in a window (money actually collected; Settled = reconciled).
export async function getTransactionsTool(
  startDate: string,
  endDate: string
): Promise<{
  transactions: Array<{
    id: number;
    time: string;
    amount: number;
    status?: string;
    settled: boolean;
    saleId?: number;
    clientId?: string;
  }>;
  page: { returned: number; totalMatching: number; hasMore: boolean };
}> {
  const resp = await mindbodyClient.get<any>('/sale/transactions', {
    params: { StartDateTime: toStartDateTime(startDate), EndDateTime: toEndDateTime(endDate), Limit: 200 },
  });
  const raw = resp.Transactions || [];
  const total = resp.PaginationResponse?.TotalResults ?? raw.length;
  const transactions = raw.map((t: any) => ({
    id: t.TransactionId ?? t.Id,
    time: t.TransactionTime,
    amount: t.Amount ?? 0,
    status: t.Status,
    settled: t.Settled === true || t.Settled === 'true',
    saleId: t.SaleId,
    clientId: t.ClientId,
  }));
  return {
    transactions,
    page: { returned: transactions.length, totalMatching: total, hasMore: transactions.length < total },
  };
}

// Aggregate revenue for a window. Returns the metric, never the rows.
// gross = sum of sale payments; collected = sum of settled transactions;
// recurring vs nonRecurring split is a best-effort item classification.
export async function getSalesSummaryTool(
  startDate: string,
  endDate: string,
  revenueType: 'all' | 'recurring' | 'nonrecurring' = 'all'
): Promise<{
  window: { startDate: string; endDate: string };
  gross: number;
  collected: number | null;
  recurring: number | null;
  nonRecurring: number | null;
  salesCount: number;
  truncated: boolean;
  note?: string;
}> {
  const { sales, total, truncated } = await fetchAllSales(startDate, endDate);

  let gross = 0;
  let recurring = 0;
  let nonRecurring = 0;
  let itemAmountsSeen = false;

  for (const s of sales) {
    const saleGross = (s.Payments || []).reduce((sum: number, p: any) => sum + (p.Amount || 0), 0);
    gross += saleGross;
    for (const item of s.PurchasedItems || []) {
      const amt = itemAmount(item);
      if (amt) itemAmountsSeen = true;
      if (isRecurringItem(item)) recurring += amt;
      else nonRecurring += amt;
    }
  }

  const hasSplit = itemAmountsSeen;
  const result = {
    window: { startDate, endDate },
    gross: round2(gross),
    // Settlement reconciliation lives in /sale/transactions (use getTransactions),
    // whose date filtering is unreliable, so it's intentionally not summed here.
    collected: null as number | null,
    recurring: hasSplit ? round2(recurring) : null,
    nonRecurring: hasSplit ? round2(nonRecurring) : null,
    salesCount: total,
    truncated,
    note: hasSplit
      ? 'gross + recurring/nonRecurring from /sale/sales (exact). collected (settled) omitted — use getTransactions for reconciliation.'
      : 'gross from /sale/sales (exact); per-item amounts unavailable so recurring split omitted.',
  };

  if (revenueType === 'recurring') return { ...result, nonRecurring: null };
  if (revenueType === 'nonrecurring') return { ...result, recurring: null };
  return result;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}