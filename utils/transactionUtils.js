/**
 * Authoritative Transaction Direction Engine (Backend Port)
 * Determines if a transaction is incoming ("in") or outgoing ("out")
 * based on transaction category, fromUser/toUser relationships, and current userId.
 */
function getTransactionDirection(tx, currentUserId) {
  if (!tx) return "out";

  const fromId = tx.fromUser?._id || tx.fromUser || null;
  const toId = tx.toUser?._id || tx.toUser || null;
  const category = tx.transactionCategory || tx.category || tx.type || "";
  const currentIdStr = currentUserId ? String(currentUserId) : "";

  // 1. Categorical incoming
  if (category === "deposit") {
    return "in";
  }

  // 2. Categorical outgoing
  if (category === "subscription_lock" || category === "withdrawal") {
    return "out";
  }

  // 3. Contextual / Role & Ownership based check
  if (category === "funding") {
    if (toId && String(toId) === currentIdStr) {
      return "in";
    }
    if (fromId && String(fromId) === currentIdStr) {
      return "out";
    }
    return "in"; // Default student view of sponsorship funding
  }

  if (
    category === "custom_order" ||
    category === "quick_order" ||
    category === "mpesa_direct_order"
  ) {
    if (fromId && String(fromId) === currentIdStr) {
      return "out";
    }
    if (toId && String(toId) === currentIdStr) {
      return "in";
    }
    return "out"; // Default student side purchase
  }

  if (
    category === "escrow_release" ||
    category === "vendor_payout" ||
    category === "refund"
  ) {
    if (toId && String(toId) === currentIdStr) {
      return "in";
    }
    if (fromId && String(fromId) === currentIdStr) {
      return "out";
    }
    if (category === "refund") return "in"; // Refund is incoming
    return "out";
  }

  if (category === "commission") {
    if (toId && String(toId) === currentIdStr) {
      return "in"; // Admin receives commission
    }
    return "out";
  }

  // Description-based fallbacks
  const desc = String(tx.description || "").toLowerCase();
  if (
    desc.includes("refund") ||
    desc.includes("deposit") ||
    desc.includes("top-up") ||
    desc.includes("funding") ||
    desc.includes("received")
  ) {
    return "in";
  }

  return "out";
}

function explainTransaction(tx) {
  if (!tx) return { source: "System", destination: "System", purpose: "Internal Settlement" };

  const category = tx.transactionCategory || tx.category || tx.type || "";
  const desc = tx.description || "";
  
  // Helper to get descriptive name and role
  const getEntityLabel = (user, fallbackRole) => {
    if (!user) return null;
    const name = user.name || user.email || "System";
    const role = user.role || fallbackRole || "";
    const roleLabel = role ? ` (${role.charAt(0).toUpperCase() + role.slice(1)})` : "";
    return `${name}${roleLabel}`;
  };

  const fromLabel = getEntityLabel(tx.fromUser, "student");
  const toLabel = getEntityLabel(tx.toUser, "vendor");

  let source = "System / Escrow";
  let destination = "System / Escrow";
  let purpose = desc || "System Transaction";

  if (category === 'deposit') {
    source = "M-Pesa Direct / Sponsor";
    destination = toLabel || "Student Wallet";
    purpose = desc || "Wallet Deposit / Funding";
  } else if (category === 'subscription_lock') {
    source = fromLabel || "Student Wallet";
    destination = "Subscription Escrow";
    purpose = desc || "Locked Subscription Funds";
  } else if (category === 'escrow_release' || category === 'vendor_payout') {
    source = "Subscription Escrow";
    destination = toLabel || "Vendor Settlement";
    purpose = desc || "Daily Delivery Payout Release";
  } else if (category === 'commission') {
    source = fromLabel || "Vendor Settlement";
    destination = "Platform Revenue";
    purpose = desc || "Platform Commission (10%)";
  } else if (category === 'custom_order' || category === 'quick_order' || category === 'mpesa_direct_order') {
    source = fromLabel || "Student Wallet";
    destination = toLabel || "Vendor Settlement";
    purpose = desc || "Quick / Custom Meal Order Payment";
  } else if (category === 'withdrawal') {
    source = fromLabel || "Vendor Settlement";
    destination = "M-Pesa Cashout / External";
    purpose = desc || "M-Pesa Revenue Withdrawal";
  } else if (category === 'refund') {
    source = "Subscription Escrow";
    destination = toLabel || "Student Wallet";
    purpose = desc || "Subscription Cancellation Refund";
  } else {
    source = fromLabel || "System / Escrow";
    destination = toLabel || "System / Escrow";
  }

  return { source, destination, purpose };
}

module.exports = {
  getTransactionDirection,
  explainTransaction
};
