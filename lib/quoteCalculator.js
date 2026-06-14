export const CATEGORY_DAILY_RATES = {
  灯具: 120,
  控台: 300,
  桁架: 60,
  线缆: 20,
  其他: 50
};

export const CATEGORY_DEPOSIT_RATES = {
  灯具: 500,
  控台: 2000,
  桁架: 300,
  线缆: 100,
  其他: 200
};

export function calcRentalDays(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffMs = end - start;
  if (diffMs < 0) return 0;
  const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(days, 1);
}

export function calcItemDailyPrice(category) {
  return CATEGORY_DAILY_RATES[category] ?? CATEGORY_DAILY_RATES.其他;
}

export function calcItemDeposit(category) {
  return CATEGORY_DEPOSIT_RATES[category] ?? CATEGORY_DEPOSIT_RATES.其他;
}

export function calcSubtotal(equipmentMap, itemIds, rentalDays) {
  return itemIds.reduce((sum, id) => {
    const eq = equipmentMap.get(id);
    if (!eq) return sum;
    return sum + calcItemDailyPrice(eq.category) * rentalDays;
  }, 0);
}

export function calcTotalDeposit(equipmentMap, itemIds, overridePerItem = {}) {
  return itemIds.reduce((sum, id) => {
    const eq = equipmentMap.get(id);
    if (!eq) return sum;
    const override = overridePerItem[id];
    const perItem = (override && override.deposit != null) ? override.deposit : calcItemDeposit(eq.category);
    return sum + perItem;
  }, 0);
}

export function applyDiscount(subtotal, discount) {
  const d = Number(discount) || 0;
  if (d < 0) return Math.max(subtotal, 0);
  let result;
  if (d <= 1) {
    result = subtotal * (1 - d);
  } else {
    result = subtotal - d;
  }
  result = Math.max(result, 0);
  return Math.round(result * 100) / 100;
}

export function formatDiscountLabel(discount) {
  const d = Number(discount) || 0;
  if (d === 0) return "无折扣";
  if (d <= 1) return `${Math.round((1 - d) * 100)}% 折扣`;
  return `减 ¥${d}`;
}

export function buildQuoteSummary(equipment, itemIds, startDate, endDate, depositOverride = {}, discount = 0) {
  const equipmentMap = new Map(equipment.map((e) => [e.id, e]));
  const rentalDays = calcRentalDays(startDate, endDate);
  const subtotal = calcSubtotal(equipmentMap, itemIds, rentalDays);
  const totalDeposit = calcTotalDeposit(equipmentMap, itemIds, depositOverride);
  const discounted = applyDiscount(subtotal, discount);
  const discountAmount = Math.round((subtotal - discounted) * 100) / 100;
  const grandTotal = discounted + totalDeposit;

  return {
    rentalDays,
    subtotal,
    discountAmount,
    discounted,
    totalDeposit,
    grandTotal,
    itemBreakdown: itemIds.map((id) => {
      const eq = equipmentMap.get(id);
      if (!eq) return null;
      const daily = calcItemDailyPrice(eq.category);
      const dep = (depositOverride[id] && depositOverride[id].deposit != null)
        ? depositOverride[id].deposit
        : calcItemDeposit(eq.category);
      return {
        id,
        name: eq.name,
        category: eq.category,
        spec: eq.spec,
        daily,
        subtotal: daily * rentalDays,
        deposit: dep
      };
    }).filter(Boolean)
  };
}
