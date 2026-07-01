import { useState, useEffect, useRef, useCallback } from "react";
import {
  apiLogin, apiSaveTenant, apiAddSale,
  apiAdminLogin, apiAdminListTenants, apiAdminCreateTenant,
  apiAdminUpdateTenant, apiAdminDeleteTenant, apiExecuteSql,
} from "../lib/api";
import { API_BASE, SUPABASE_ANON_KEY } from "../lib/supabase";
import {
  X, Plus, Minus, CreditCard, Banknote, Users, Clock, ChevronRight,
  Receipt, Trash2, AlertCircle, Settings, ShoppingBag, Monitor,
  Package, Globe, Edit2, Check, Printer, ArrowLeft, Save,
  Smartphone, Building2, Bitcoin, QrCode, Zap, BarChart2,
  TrendingUp, Calendar, ChevronDown, Tag, Star, LogOut,
  User, Shield, Upload, Phone, Mail, MapPin, Percent,
  Info, CheckCircle, Eye, EyeOff, Store,
  UserCheck, Bell,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type AppScreen = "landing" | "superadmin_login" | "superadmin" | "venue_login" | "pos" | "admin" | "client";
type AdminSection =
  | "products" | "categories" | "payment-methods" | "currencies"
  | "vat" | "business" | "staff" | "customers" | "sales" | "system";

type StaffPermissionKey =
  | "adminAccess"
  | "editProducts"
  | "editCategories"
  | "editPayments"
  | "editCurrencies"
  | "editVat"
  | "editBusiness"
  | "manageStaff"
  | "manageCustomers"
  | "viewSales"
  | "manageSystem"
  | "openTabs"
  | "editOrders"
  | "chargeTabs"
  | "useClientDisplay";

interface StaffPermissions {
  adminAccess: boolean;
  editProducts: boolean;
  editCategories: boolean;
  editPayments: boolean;
  editCurrencies: boolean;
  editVat: boolean;
  editBusiness: boolean;
  manageStaff: boolean;
  manageCustomers: boolean;
  viewSales: boolean;
  manageSystem: boolean;
  openTabs: boolean;
  editOrders: boolean;
  chargeTabs: boolean;
  useClientDisplay: boolean;
}

interface StaffMember { id: string; name: string; pin: string; role: "owner" | "manager" | "bartender"; permissions: StaffPermissions; }
interface Customer { id: string; name: string; email: string; phone: string; totalSpent: number; visits: number; notes: string; }
interface CategoryConfig { name: string; enabled: boolean; }
interface Currency { code: string; symbol: string; name: string; rate: number; enabled: boolean; }
interface PaymentMethod { id: string; name: string; icon: string; enabled: boolean; custom?: boolean; }
interface HardwareDevice {
  id: string;
  name: string;
  connection: "usb" | "network" | "bluetooth";
  target: string;
  enabled: boolean;
}

interface PersistedPosTab {
  id: string;
  name: string;
  orders: OrderItem[];
  opened: string;
  customerId?: string;
  prepaid?: number;
}

interface PersistedPosState {
  tabs: PersistedPosTab[];
  activeTabId: string | null;
}

interface TenantConfig {
  defaultCurrencyCode: string;
  currencies: Currency[];
  paymentMethods: PaymentMethod[];
  categories: CategoryConfig[];
  vatEnabled: boolean;
  vatRate: number;
  printers: HardwareDevice[];
  scanners: HardwareDevice[];
  defaultPrinterId?: string;
  defaultScannerId?: string;
  posState?: PersistedPosState;
}

interface BusinessInfo {
  name: string; logo: string | null; address: string; phone: string;
  email: string; website: string; regNumber: string; vatNumber: string;
}

interface MenuItem {
  id: string; name: string; category: string; price: number;
  description: string; stock: number; popular?: boolean;
}

interface OrderItem { menuItem: MenuItem; qty: number; }

interface Tab {
  id: string; name: string; orders: OrderItem[]; opened: Date;
  customerId?: string; prepaid?: number;
}

interface SaleRecord {
  id: string; tabName: string; items: OrderItem[];
  subtotal: number; tax: number; total: number; totalConverted: number;
  paymentMethod: string; currencyCode: string; currencySymbol: string;
  timestamp: Date; staffId: string; customerId?: string;
  prepaid?: number; change?: number;
}

interface Tenant {
  id: string; email: string; password: string;
  tenantToken?: string;
  plan: "starter" | "pro" | "enterprise";
  businessInfo: BusinessInfo; config: TenantConfig;
  menu: MenuItem[]; sales: SaleRecord[];
  customers: Customer[]; staff: StaffMember[];
  createdAt: Date;
}

interface Session { tenantId: string; staffId: string; }
interface TenantSummary { email: string; name: string; logo?: string | null; paused?: boolean; createdAt: string; }

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const PAYMENT_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  cash: Banknote, card: CreditCard, qr: QrCode, bank: Building2,
  mobile: Smartphone, bitcoin: Bitcoin, zap: Zap,
};

const CHANGELOG = [
  { version: "2.4.0", date: "15 Jun 2026", notes: ["Multi-currency checkout", "Pre-pay / deposit tabs", "Customer accounts", "VAT toggle per business"] },
  { version: "2.3.1", date: "2 Jun 2026", notes: ["Receipt printing improvements", "Stock limit enforcement", "Category management"] },
  { version: "2.2.0", date: "18 May 2026", notes: ["Client display view", "Sales analytics dashboard", "Custom payment methods"] },
  { version: "2.1.0", date: "1 May 2026", notes: ["Platform launch", "Staff PIN login", "Business branding"] },
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function fmtTime(d: Date) { return d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: true }); }
function fmtDate(d: Date) { return d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" }); }
function dateKey(d: Date) { return d.toISOString().slice(0, 10); }
function calcSubtotal(orders: OrderItem[]) { return orders.reduce((s, o) => s + o.menuItem.price * o.qty, 0); }
function elapsed(d: Date) {
  const m = Math.floor((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "now"; if (m < 60) return `${m}m`; return `${Math.floor(m / 60)}h ${m % 60}m`;
}
function fmt(amount: number, cur: Currency) { return `${cur.symbol}${(amount * cur.rate).toFixed(2)}`; }
let _seq = 300;
function uid() { return `id_${++_seq}`; }
function calcTax(sub: number, cfg: TenantConfig) { return cfg.vatEnabled ? sub * (cfg.vatRate / 100) : 0; }
function TenantBrandMark({ businessInfo, size = "md", className = "" }: { businessInfo: BusinessInfo; size?: "sm" | "md" | "lg"; className?: string }) {
  const sizes = {
    sm: { image: "h-7", box: "w-7 h-7 rounded-md", text: "text-xs" },
    md: { image: "h-12", box: "w-12 h-12 rounded-xl", text: "text-xl" },
    lg: { image: "h-14", box: "w-14 h-14 rounded-xl", text: "text-xl" },
  } as const;

  const cfg = sizes[size];
  const initials = businessInfo.name.slice(0, 2).toUpperCase();

  if (businessInfo.logo) {
    return <img src={businessInfo.logo} alt={`${businessInfo.name} logo`} className={`${cfg.image} object-contain ${className}`.trim()} />;
  }

  return (
    <div className={`${cfg.box} bg-primary/20 border border-primary/30 flex items-center justify-center ${className}`.trim()}>
      <span className={`text-primary font-black ${cfg.text}`} style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>{initials}</span>
    </div>
  );
}

function asBool(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.toLowerCase().trim();
    if (lower === "true") return true;
    if (lower === "false") return false;
  }
  if (typeof value === "number") return value === 1;
  return fallback;
}

function defaultPermissionsForRole(role: StaffMember["role"]): StaffPermissions {
  if (role === "owner") {
    return {
      adminAccess: true,
      editProducts: true,
      editCategories: true,
      editPayments: true,
      editCurrencies: true,
      editVat: true,
      editBusiness: true,
      manageStaff: true,
      manageCustomers: true,
      viewSales: true,
      manageSystem: true,
      openTabs: true,
      editOrders: true,
      chargeTabs: true,
      useClientDisplay: true,
    };
  }

  if (role === "manager") {
    return {
      adminAccess: false,
      editProducts: true,
      editCategories: true,
      editPayments: false,
      editCurrencies: false,
      editVat: false,
      editBusiness: false,
      manageStaff: false,
      manageCustomers: true,
      viewSales: true,
      manageSystem: false,
      openTabs: true,
      editOrders: true,
      chargeTabs: true,
      useClientDisplay: true,
    };
  }

  return {
    adminAccess: false,
    editProducts: false,
    editCategories: false,
    editPayments: false,
    editCurrencies: false,
    editVat: false,
    editBusiness: false,
    manageStaff: false,
    manageCustomers: false,
    viewSales: false,
    manageSystem: false,
    openTabs: true,
    editOrders: true,
    chargeTabs: true,
    useClientDisplay: true,
  };
}

function normalizePermissions(raw: unknown, role: StaffMember["role"]): StaffPermissions {
  const defaults = defaultPermissionsForRole(role);
  if (!raw || typeof raw !== "object") return defaults;
  const permissions = raw as Partial<StaffPermissions>;

  return {
    adminAccess: asBool(permissions.adminAccess, defaults.adminAccess),
    editProducts: asBool(permissions.editProducts, defaults.editProducts),
    editCategories: asBool(permissions.editCategories, defaults.editCategories),
    editPayments: asBool(permissions.editPayments, defaults.editPayments),
    editCurrencies: asBool(permissions.editCurrencies, defaults.editCurrencies),
    editVat: asBool(permissions.editVat, defaults.editVat),
    editBusiness: asBool(permissions.editBusiness, defaults.editBusiness),
    manageStaff: asBool(permissions.manageStaff, defaults.manageStaff),
    manageCustomers: asBool(permissions.manageCustomers, defaults.manageCustomers),
    viewSales: asBool(permissions.viewSales, defaults.viewSales),
    manageSystem: asBool(permissions.manageSystem, defaults.manageSystem),
    openTabs: asBool(permissions.openTabs, defaults.openTabs),
    editOrders: asBool(permissions.editOrders, defaults.editOrders),
    chargeTabs: asBool(permissions.chargeTabs, defaults.chargeTabs),
    useClientDisplay: asBool(permissions.useClientDisplay, defaults.useClientDisplay),
  };
}

function serializeTabs(tabs: Tab[]): PersistedPosTab[] {
  return tabs.map((tab) => ({
    id: tab.id,
    name: tab.name,
    orders: tab.orders,
    opened: tab.opened.toISOString(),
    customerId: tab.customerId,
    prepaid: tab.prepaid,
  }));
}

function hydrateTabs(rawTabs: unknown): Tab[] {
  if (!Array.isArray(rawTabs)) return [];

  return rawTabs
    .map((raw) => {
      const tab = raw as Partial<PersistedPosTab>;
      if (!tab.id || !tab.name || !Array.isArray(tab.orders)) return null;
      const openedDate = tab.opened ? new Date(tab.opened) : new Date();
      const opened = Number.isNaN(openedDate.getTime()) ? new Date() : openedDate;

      return {
        id: tab.id,
        name: tab.name,
        orders: tab.orders,
        opened,
        customerId: tab.customerId,
        prepaid: typeof tab.prepaid === "number" ? tab.prepaid : undefined,
      } as Tab;
    })
    .filter((tab): tab is Tab => tab !== null);
}

// Convert API row → Tenant
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTenant(row: any): Tenant {
  const rawConfig = row.config ?? {};
  const mergedConfig = makeConfig({
    ...rawConfig,
    currencies: Array.isArray(rawConfig.currencies) ? rawConfig.currencies : makeConfig().currencies,
    paymentMethods: Array.isArray(rawConfig.paymentMethods) ? rawConfig.paymentMethods : makeConfig().paymentMethods,
    categories: Array.isArray(rawConfig.categories) ? rawConfig.categories : makeConfig().categories,
    printers: Array.isArray(rawConfig.printers) ? rawConfig.printers : makeConfig().printers,
    scanners: Array.isArray(rawConfig.scanners) ? rawConfig.scanners : makeConfig().scanners,
  });

  const normalizedConfig: TenantConfig = {
    ...mergedConfig,
    currencies: mergedConfig.currencies.map((c) => ({
      ...c,
      enabled: asBool(c.enabled, true),
    })),
    paymentMethods: mergedConfig.paymentMethods.map((m) => ({
      ...m,
      enabled: asBool(m.enabled, true),
      custom: asBool(m.custom, false),
    })),
    categories: mergedConfig.categories.map((cat) => ({
      ...cat,
      enabled: asBool(cat.enabled, true),
    })),
    printers: (mergedConfig.printers ?? []).map((d) => ({
      id: String(d.id ?? uid()),
      name: String(d.name ?? "Printer"),
      connection: (d.connection === "network" || d.connection === "bluetooth" ? d.connection : "usb") as HardwareDevice["connection"],
      target: String(d.target ?? ""),
      enabled: asBool(d.enabled, true),
    })),
    scanners: (mergedConfig.scanners ?? []).map((d) => ({
      id: String(d.id ?? uid()),
      name: String(d.name ?? "Scanner"),
      connection: (d.connection === "network" || d.connection === "bluetooth" ? d.connection : "usb") as HardwareDevice["connection"],
      target: String(d.target ?? ""),
      enabled: asBool(d.enabled, true),
    })),
    defaultPrinterId: mergedConfig.defaultPrinterId,
    defaultScannerId: mergedConfig.defaultScannerId,
  };

  return {
    id: row.id,
    email: row.email,
    password: "",
    tenantToken: row.tenantToken,
    plan: row.plan ?? "starter",
    businessInfo: row.businessInfo ?? row.business_info ?? { name: "", logo: null, address: "", phone: "", email: row.email, website: "", regNumber: "", vatNumber: "" },
    config: normalizedConfig,
    menu: (row.menu ?? []).map((m: any) => ({ ...m })),
    sales: (row.sales ?? []).map((s: any) => ({ ...s, timestamp: new Date(s.timestamp ?? s.savedAt ?? Date.now()) })),
    customers: (row.customers ?? []).map((c: any) => ({ id: c.id, name: c.name, email: c.email ?? "", phone: c.phone ?? "", totalSpent: c.total_spent ?? c.totalSpent ?? 0, visits: c.visits ?? 0, notes: c.notes ?? "" })),
    staff: (row.staff ?? []).map((s: any) => {
      const role = (s.role === "owner" || s.role === "manager" || s.role === "bartender") ? s.role : "bartender";
      return {
        id: s.id,
        name: s.name,
        pin: s.pin,
        role,
        permissions: normalizePermissions(s.permissions, role),
      };
    }),
    createdAt: new Date(row.createdAt ?? row.created_at ?? Date.now()),
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// SEED DATA
// ─────────────────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    defaultCurrencyCode: "ZAR", vatEnabled: true, vatRate: 15,
    currencies: [
      { code: "ZAR", symbol: "R", name: "South African Rand", rate: 1, enabled: true },
      { code: "USD", symbol: "$", name: "US Dollar", rate: 0.054, enabled: true },
      { code: "EUR", symbol: "€", name: "Euro", rate: 0.050, enabled: false },
      { code: "GBP", symbol: "£", name: "British Pound", rate: 0.043, enabled: false },
      { code: "NAD", symbol: "N$", name: "Namibian Dollar", rate: 1.0, enabled: false },
      { code: "BWP", symbol: "P", name: "Botswana Pula", rate: 0.073, enabled: false },
      { code: "ZMW", symbol: "K", name: "Zambian Kwacha", rate: 1.42, enabled: false },
    ],
    paymentMethods: [
      { id: "cash", name: "Cash", icon: "cash", enabled: true },
      { id: "card", name: "Card", icon: "card", enabled: true },
      { id: "snapscan", name: "SnapScan", icon: "qr", enabled: true },
      { id: "zapper", name: "Zapper", icon: "qr", enabled: false },
      { id: "eft", name: "EFT", icon: "bank", enabled: false },
      { id: "applepay", name: "Apple Pay", icon: "mobile", enabled: false },
    ],
    categories: [
      { name: "Cocktails", enabled: true }, { name: "Beer", enabled: true },
      { name: "Spirits", enabled: true }, { name: "Wine", enabled: true },
      { name: "N/A", enabled: true }, { name: "Food", enabled: true },
    ],
    printers: [],
    scanners: [],
    defaultPrinterId: undefined,
    defaultScannerId: undefined,
    ...overrides,
  };
}

const NOIR_MENU: MenuItem[] = [
  { id: "c1", name: "Negroni", category: "Cocktails", price: 145, description: "Gin · Campari · Sweet Vermouth", stock: -1, popular: true },
  { id: "c2", name: "Old Fashioned", category: "Cocktails", price: 155, description: "Bourbon · Angostura · Orange", stock: -1, popular: true },
  { id: "c3", name: "Aperol Spritz", category: "Cocktails", price: 130, description: "Aperol · Prosecco · Soda", stock: -1 },
  { id: "c4", name: "Espresso Martini", category: "Cocktails", price: 165, description: "Vodka · Kahlúa · Espresso", stock: -1, popular: true },
  { id: "c5", name: "Paper Plane", category: "Cocktails", price: 155, description: "Bourbon · Aperol · Amaro · Lemon", stock: -1 },
  { id: "b1", name: "Modelo Especial", category: "Beer", price: 65, description: "Mexican Lager · 4.4%", stock: 24 },
  { id: "b2", name: "Guinness Draught", category: "Beer", price: 75, description: "Irish Stout · 4.2%", stock: -1, popular: true },
  { id: "b3", name: "Lagunitas IPA", category: "Beer", price: 80, description: "West Coast IPA · 6.2%", stock: 12 },
  { id: "b4", name: "Stella Artois", category: "Beer", price: 65, description: "Belgian Lager · 5.0%", stock: -1 },
  { id: "b5", name: "Pacifico", category: "Beer", price: 60, description: "Mexican Lager · 4.5%", stock: 0 },
  { id: "s1", name: "Don Julio Blanco", category: "Spirits", price: 120, description: "Tequila · 25ml", stock: -1 },
  { id: "s2", name: "Macallan 12", category: "Spirits", price: 195, description: "Single Malt Scotch · 25ml", stock: -1, popular: true },
  { id: "s3", name: "Hendrick's Gin", category: "Spirits", price: 110, description: "Scottish Gin · 25ml", stock: -1 },
  { id: "s4", name: "Woodford Reserve", category: "Spirits", price: 120, description: "Kentucky Bourbon · 25ml", stock: -1 },
  { id: "w1", name: "Whispering Angel", category: "Wine", price: 145, description: "Provence Rosé · Glass", stock: 8 },
  { id: "w2", name: "Meiomi Pinot Noir", category: "Wine", price: 130, description: "California Red · Glass", stock: 0 },
  { id: "w3", name: "Sauvignon Blanc", category: "Wine", price: 110, description: "New Zealand White · Glass", stock: 14 },
  { id: "n1", name: "San Pellegrino", category: "N/A", price: 45, description: "Sparkling Water · 500ml", stock: -1 },
  { id: "n2", name: "House Lemonade", category: "N/A", price: 50, description: "Fresh-Squeezed · Mint", stock: -1 },
  { id: "f1", name: "Cheese Board", category: "Food", price: 185, description: "3 cheeses · crackers · grapes", stock: 5 },
  { id: "f2", name: "Marinated Olives", category: "Food", price: 75, description: "Citrus · herbs · olive oil", stock: -1 },
];

const ROASTERY_MENU: MenuItem[] = [
  { id: "r1", name: "Flat White", category: "Coffee", price: 52, description: "Double ristretto · steamed milk", stock: -1, popular: true },
  { id: "r2", name: "Cappuccino", category: "Coffee", price: 48, description: "Espresso · foam · cinnamon", stock: -1 },
  { id: "r3", name: "Cold Brew", category: "Coffee", price: 65, description: "12-hour steep · over ice", stock: -1 },
  { id: "r4", name: "Matcha Latte", category: "Tea", price: 58, description: "Ceremonial grade · oat milk", stock: 10 },
  { id: "r5", name: "Chai Latte", category: "Tea", price: 52, description: "House spice blend · steamed milk", stock: -1 },
  { id: "r6", name: "Croissant", category: "Food", price: 45, description: "Butter · almond", stock: 8 },
  { id: "r7", name: "Banana Bread", category: "Food", price: 38, description: "Homemade · chocolate chips", stock: 4 },
  { id: "r8", name: "Sparkling Water", category: "Drinks", price: 35, description: "500ml", stock: -1 },
];

const TAPROOM_MENU: MenuItem[] = [
  { id: "t1", name: "Saggy Stone Pale Ale", category: "Craft Beer", price: 85, description: "American Pale · 5.0% ABV", stock: 48, popular: true },
  { id: "t2", name: "Jack Black Lager", category: "Craft Beer", price: 75, description: "German Lager · 4.5% ABV", stock: 36 },
  { id: "t3", name: "Darling Brew IPA", category: "Craft Beer", price: 90, description: "IPA · 6.5% ABV", stock: 24 },
  { id: "t4", name: "CBC Amber Weiss", category: "Craft Beer", price: 80, description: "Wheat Beer · 4.8% ABV", stock: 0 },
  { id: "t5", name: "Nachos", category: "Snacks", price: 95, description: "Cheese · jalapeños · guac", stock: -1 },
  { id: "t6", name: "Beer Battered Wings", category: "Snacks", price: 115, description: "6 wings · peri sauce", stock: -1, popular: true },
];

// ─────────────────────────────────────────────────────────────────────────────
// LANDING (no public sign-in — admin-only onboarding)
// ─────────────────────────────────────────────────────────────────────────────

function LandingPage({ onVenueLogin, onSuperAdmin }: { onVenueLogin: () => void; onSuperAdmin: () => void }) {
  const features = [
    { icon: Store, title: "Multi-Venue Ready", desc: "Each business gets isolated POS, sales data, and users." },
    { icon: Users, title: "User PIN Login", desc: "Role-based access for owners, managers, and bartenders." },
    { icon: Globe, title: "Multi-Currency", desc: "Accept ZAR, USD, EUR and more. Exchange rates you control." },
    { icon: BarChart2, title: "Sales Analytics", desc: "Daily reports, top items, payment breakdowns by date." },
    { icon: UserCheck, title: "Customer Accounts", desc: "Track visits, total spend, and notes for regulars." },
    { icon: Printer, title: "Receipt Printing", desc: "Print receipts with your logo and business details." },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col" style={{ fontFamily: "'Barlow', sans-serif" }}>
      {/* Nav */}
      <nav className="flex items-center justify-between px-8 py-4 border-b border-border sticky top-0 bg-background/90 backdrop-blur-sm z-20">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center"><span className="text-primary-foreground font-black text-sm" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>P</span></div>
          <span className="text-lg font-black tracking-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>POURPOS</span>
        </div>
        <button onClick={onVenueLogin} className="rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 px-4 py-2 transition-colors">
          Venue Access
        </button>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-8 py-24 text-center max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary font-semibold mb-6">
          <Zap size={11} /> Cloud POS Platform
        </div>
        <h1 className="text-5xl md:text-6xl font-black text-foreground mb-5 leading-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
          THE POS BUILT FOR<br /><span className="text-primary">BARS & VENUES</span>
        </h1>
        <p className="text-lg text-muted-foreground mb-10 max-w-xl">
          Cloud-based point-of-sale for bars, restaurants, and cafés. Each venue gets their own isolated system — managed by your team.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full max-w-4xl text-left mt-4">
          {features.map(({ icon: Icon, title, desc }) => (
            <div key={title} className="rounded-xl border border-border bg-card/30 p-5">
              <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center mb-3"><Icon size={17} className="text-primary" /></div>
              <h3 className="text-sm font-bold text-foreground mb-1">{title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer — superadmin link (subtle) */}
      <footer className="border-t border-border px-8 py-4 flex items-center justify-between">
        <p className="text-xs text-muted-foreground/40">© 2026 PourPOS. All rights reserved.</p>
        <button
          onClick={onSuperAdmin}
          className="text-[10px] text-muted-foreground/25 hover:text-muted-foreground transition-colors"
          style={{ fontFamily: "'DM Mono', monospace" }}
        >
          ● admin
        </button>
      </footer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPERADMIN LOGIN
// ─────────────────────────────────────────────────────────────────────────────

function SuperAdminLogin({ onSuccess, onBack }: { onSuccess: (token: string) => void; onBack: () => void }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email.trim() || !password) { setError("Enter credentials."); return; }
    setLoading(true); setError("");
    try {
      const data = await apiAdminLogin(email.trim(), password);
      onSuccess(data.token);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Invalid credentials");
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4" style={{ fontFamily: "'Barlow', sans-serif" }}>
      <button onClick={onBack} className="absolute top-6 left-6 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"><ArrowLeft size={14} /> Back</button>
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <div className="w-9 h-9 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center"><Shield size={16} className="text-primary" /></div>
          <span className="text-xl font-black tracking-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>SUPERADMIN</span>
        </div>
        <div className="rounded-2xl border border-border bg-card/40 p-7">
          <h2 className="text-lg font-bold mb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>Admin Portal</h2>
          <p className="text-sm text-muted-foreground mb-5">Restricted access. Authorised personnel only.</p>
          {error && <div className="flex items-center gap-2 rounded-lg bg-red-900/20 border border-red-900/30 px-3 py-2.5 text-xs text-red-400 mb-4"><AlertCircle size={13} />{error}</div>}
          <div className="mb-3">
            <label className="text-xs text-muted-foreground mb-1 block">Email</label>
            <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} placeholder="admin@yourcompany.com" className="w-full rounded-lg bg-white/5 border border-border px-4 py-3 text-sm text-foreground focus:outline-none focus:border-primary/50" />
          </div>
          <div className="mb-5">
            <label className="text-xs text-muted-foreground mb-1 block">Password</label>
            <div className="relative">
              <input type={showPw ? "text" : "password"} value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }} onKeyDown={(e) => e.key === "Enter" && handleLogin()} placeholder="••••••••" className="w-full rounded-lg bg-white/5 border border-border px-4 py-3 pr-10 text-sm text-foreground focus:outline-none focus:border-primary/50" />
              <button onClick={() => setShowPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">{showPw ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            </div>
          </div>
          <button onClick={handleLogin} disabled={loading} className="w-full rounded-xl bg-primary text-primary-foreground py-3.5 font-bold text-sm tracking-wide hover:opacity-90 transition-opacity disabled:opacity-60" style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.06em" }}>
            {loading ? "Authenticating…" : "ACCESS PORTAL"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPERADMIN DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

function SuperAdminDashboard({ token, onBack }: { token: string; onBack: () => void }) {
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ email: "", password: "", businessName: "" });
  const [formError, setFormError] = useState(""); const [formLoading, setFormLoading] = useState(false); const [formSuccess, setFormSuccess] = useState("");
  const [deletingEmail, setDeletingEmail] = useState<string | null>(null);
  const [pausingEmail, setPausingEmail] = useState<string | null>(null);
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editPw, setEditPw] = useState(""); const [editLoading, setEditLoading] = useState(false);
  const [sqlText, setSqlText] = useState("SELECT email, name, createdAt FROM tenants LIMIT 25;");
  const [sqlResult, setSqlResult] = useState<any | null>(null);
  const [sqlError, setSqlError] = useState(""); const [sqlLoading, setSqlLoading] = useState(false);

  useEffect(() => {
    loadTenants();
  }, []);

  async function loadTenants() {
    setLoading(true);
    try { setTenants(await apiAdminListTenants(token)); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed to load"); }
    finally { setLoading(false); }
  }

  async function handleCreate() {
    if (!form.email.trim() || !form.password || !form.businessName.trim()) { setFormError("All fields are required."); return; }
    if (form.password.length < 6) { setFormError("Password must be at least 6 characters."); return; }
    setFormLoading(true); setFormError(""); setFormSuccess("");
    try {
      await apiAdminCreateTenant(token, { ...form });
      setFormSuccess(`Business "${form.businessName}" created. Billing is managed manually by superadmin. Default owner PIN: 1234`);
      setForm({ email: "", password: "", businessName: "" });
      loadTenants();
    } catch (e: unknown) { setFormError(e instanceof Error ? e.message : "Failed to register"); }
    finally { setFormLoading(false); }
  }

  async function handleDelete(email: string) {
    if (!window.confirm(`Delete company "${email}"? This is permanent.`)) return;
    setDeletingEmail(email);
    try {
      await apiAdminDeleteTenant(token, email); loadTenants();
    }
    catch (e: unknown) { alert(e instanceof Error ? e.message : "Failed to delete"); }
    finally { setDeletingEmail(null); }
  }

  async function handleEdit(email: string) {
    setEditLoading(true);
    try {
      const patch: { password?: string } = {};
      if (editPw.trim().length >= 6) patch.password = editPw.trim();
      await apiAdminUpdateTenant(token, email, patch);
      setEditingEmail(null); setEditPw(""); loadTenants();
    } catch (e: unknown) { alert(e instanceof Error ? e instanceof Error ? e.message : "Failed to update" : "Failed to update"); }
    finally { setEditLoading(false); }
  }

  async function handlePauseToggle(email: string, paused: boolean) {
    const action = paused ? "pause" : "resume";
    if (!window.confirm(`${paused ? "Pause" : "Resume"} business \"${email}\"?`)) return;
    setPausingEmail(email);
    try {
      await apiAdminUpdateTenant(token, email, { paused });
      setFormSuccess(`Business ${email} is now ${action}d.`);
      loadTenants();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Failed to update business status");
    } finally {
      setPausingEmail(null);
    }
  }

  async function runSql() {
    if (!sqlText.trim()) { setSqlError("Enter a SQL query."); return; }
    setSqlLoading(true); setSqlError(""); setSqlResult(null);
    try {
      const data = await apiExecuteSql(token, sqlText);
      setSqlResult(data);
    } catch (e: unknown) {
      setSqlError(e instanceof Error ? e.message : "SQL execution failed");
    } finally {
      setSqlLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground" style={{ fontFamily: "'Barlow', sans-serif" }}>
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card/60 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center"><Shield size={15} className="text-primary" /></div>
          <div>
            <span className="text-base font-black tracking-wide text-foreground" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>SUPERADMIN PORTAL</span>
            <span className="ml-3 text-xs text-muted-foreground" style={{ fontFamily: "'DM Mono', monospace" }}>POURPOS</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground hidden sm:block">{tenants.length} businesses managed</span>
          <button onClick={onBack} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors">
            <LogOut size={13} /> Sign Out
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* Register new company */}
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6">
          <div className="flex items-center gap-2 mb-5">
            <Plus size={16} className="text-primary" />
            <h2 className="text-lg font-bold text-foreground" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>Create New Business</h2>
          </div>
          {formError && <div className="flex items-center gap-2 rounded-lg bg-red-900/20 border border-red-900/30 px-3 py-2.5 text-xs text-red-400 mb-4"><AlertCircle size={13} />{formError}</div>}
          {formSuccess && <div className="flex items-center gap-2 rounded-lg bg-green-900/20 border border-green-900/30 px-3 py-2.5 text-xs text-green-400 mb-4"><CheckCircle size={13} />{formSuccess}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Business Name *</label>
              <input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} placeholder="Noir & Vine" className="w-full rounded-lg bg-white/5 border border-border px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Email *</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="owner@venue.co.za" className="w-full rounded-lg bg-white/5 border border-border px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Password *</label>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min 6 characters" className="w-full rounded-lg bg-white/5 border border-border px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50" />
            </div>
          </div>
          <button onClick={handleCreate} disabled={formLoading} className="flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-6 py-3 text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-opacity" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            <Plus size={14} /> {formLoading ? "Creating…" : "CREATE BUSINESS"}
          </button>
          <p className="text-xs text-muted-foreground mt-3">Billing is handled manually by superadmin. Business owners create additional users from the company admin panel.</p>
        </div>

        {/* Companies list */}
        <div>
          <h2 className="text-lg font-bold mb-4" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>Managed Businesses</h2>
          {loading ? (
            <div className="rounded-xl border border-border bg-card/20 p-12 text-center">
              <p className="text-sm text-muted-foreground">Loading companies…</p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-900/30 bg-red-900/10 p-6 text-center text-sm text-red-400">{error}</div>
          ) : tenants.length === 0 ? (
            <div className="rounded-xl border border-border bg-card/20 p-12 text-center">
              <Store size={32} className="text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No companies registered yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Use the form above to add your first venue.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tenants.map((t) => (
                <div key={t.email} className="rounded-xl border border-border bg-card/30 overflow-hidden">
                  <div className="flex items-center gap-4 px-5 py-4">
                    <TenantBrandMark
                      businessInfo={{ name: t.name ?? "", logo: t.logo ?? null, address: "", phone: "", email: t.email, website: "", regNumber: "", vatNumber: "" }}
                      size="md"
                      className="shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-bold text-foreground">{t.name}</p>
                        {t.paused && <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">PAUSED</span>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5" style={{ fontFamily: "'DM Mono', monospace" }}>{t.email}</p>
                    </div>
                    <p className="text-xs text-muted-foreground shrink-0 hidden sm:block" style={{ fontFamily: "'DM Mono', monospace" }}>
                      {t.createdAt ? new Date(t.createdAt).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handlePauseToggle(t.email, !t.paused)}
                        disabled={pausingEmail === t.email}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${t.paused ? "text-green-300 bg-green-500/10 hover:bg-green-500/20" : "text-amber-300 bg-amber-500/10 hover:bg-amber-500/20"} disabled:opacity-40`}
                      >
                        {pausingEmail === t.email ? "Saving..." : t.paused ? "Resume" : "Pause"}
                      </button>
                      <button
                        onClick={() => { setEditingEmail(editingEmail === t.email ? null : t.email); setEditPw(""); }}
                        className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                      ><Edit2 size={14} /></button>
                      <button
                        onClick={() => handleDelete(t.email)}
                        disabled={deletingEmail === t.email}
                        className="p-2 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-40"
                      ><Trash2 size={14} /></button>
                    </div>
                  </div>
                  {/* Edit row */}
                  {editingEmail === t.email && (
                    <div className="border-t border-border bg-white/2 px-5 py-4">
                      <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3" style={{ fontFamily: "'DM Mono', monospace" }}>Edit {t.name}</p>
                      <div className="flex flex-wrap gap-3 items-end">
                        <div>
                          <label className="text-xs text-muted-foreground mb-1 block">Reset Owner Password</label>
                          <input type="password" value={editPw} onChange={(e) => setEditPw(e.target.value)} placeholder="New password…" className="rounded-lg bg-white/5 border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 w-48" />
                        </div>
                        <button onClick={() => handleEdit(t.email)} disabled={editLoading} className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-50">
                          <Save size={13} /> {editLoading ? "Saving…" : "Update Access"}
                        </button>
                        <button onClick={() => setEditingEmail(null)} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card/30 p-6 mt-8">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-bold" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>SQL Editor</h2>
              <p className="text-sm text-muted-foreground">Run SQL against your Supabase database from the superadmin portal.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={runSql} disabled={sqlLoading} className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-50">{sqlLoading ? "Running…" : "Execute SQL"}</button>
              <button onClick={() => { setSqlText(""); setSqlResult(null); setSqlError(""); }} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Clear</button>
            </div>
          </div>

          <textarea value={sqlText} onChange={(e) => setSqlText(e.target.value)} rows={8} className="w-full rounded-2xl bg-[#121212] border border-border px-4 py-3 text-sm text-foreground focus:outline-none focus:border-primary/50 font-mono" placeholder="SELECT * FROM my_table WHERE ..." />

          {sqlError && <div className="mt-4 rounded-lg border border-red-700/30 bg-red-900/10 px-4 py-3 text-sm text-red-300">{sqlError}</div>}

          {sqlResult && (
            <div className="mt-4 rounded-2xl border border-border bg-background/60 p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3" style={{ fontFamily: "'DM Mono', monospace" }}>Result</p>
              {Array.isArray(sqlResult.result) ? (
                sqlResult.result.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No rows returned.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-separate border-spacing-0 text-sm">
                      <thead>
                        <tr className="bg-white/5">
                          {Object.keys(sqlResult.result[0]).map((key) => (
                            <th key={key} className="border-b border-border px-3 py-2 text-left text-xs uppercase tracking-widest text-muted-foreground">{key}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sqlResult.result.map((row: any, rowIndex: number) => (
                          <tr key={rowIndex} className={rowIndex % 2 === 0 ? "bg-white/5" : "bg-transparent"}>
                            {Object.values(row).map((value, colIndex) => (
                              <td key={colIndex} className="border-b border-border px-3 py-2 align-top text-xs text-foreground font-mono">{typeof value === "object" ? JSON.stringify(value) : String(value)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : (
                <pre className="whitespace-pre-wrap break-words text-xs text-foreground font-mono">{JSON.stringify(sqlResult, null, 2)}</pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VENUE LOGIN (for companies provisioned by superadmin)
// ─────────────────────────────────────────────────────────────────────────────

function VenueLogin({ onLogin, onBack }: { onLogin: (t: Tenant, tenantToken?: string) => void; onBack: () => void; }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    setLoading(true); setError("");
    try {
      const data = await apiLogin(email.trim(), password);
      onLogin(rowToTenant(data), data.tenantToken);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Invalid email or password");
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4" style={{ fontFamily: "'Barlow', sans-serif" }}>
      <button onClick={onBack} className="absolute top-6 left-6 flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"><ArrowLeft size={14} /> Back</button>
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center"><span className="text-primary-foreground font-black text-lg" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>P</span></div>
          <span className="text-xl font-black tracking-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>POURPOS</span>
        </div>
        <div className="rounded-2xl border border-border bg-card/40 p-7">
          <h2 className="text-xl font-bold mb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>Venue Access</h2>
          <p className="text-sm text-muted-foreground mb-5">Sign in with the credentials provided by your administrator.</p>
          {error && <div className="flex items-center gap-2 rounded-lg bg-red-900/20 border border-red-900/30 px-3 py-2.5 text-xs text-red-400 mb-4"><AlertCircle size={13} />{error}</div>}
          <div className="mb-3">
            <label className="text-xs text-muted-foreground mb-1 block">Email</label>
            <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} onKeyDown={(e) => e.key === "Enter" && handleLogin()} placeholder="owner@yourvenue.co.za" className="w-full rounded-lg bg-white/5 border border-border px-4 py-3 text-sm text-foreground focus:outline-none focus:border-primary/50" />
          </div>
          <div className="mb-5">
            <label className="text-xs text-muted-foreground mb-1 block">Password</label>
            <div className="relative">
              <input type={showPw ? "text" : "password"} value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }} onKeyDown={(e) => e.key === "Enter" && handleLogin()} placeholder="••••••••" className="w-full rounded-lg bg-white/5 border border-border px-4 py-3 pr-10 text-sm text-foreground focus:outline-none focus:border-primary/50" />
              <button onClick={() => setShowPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">{showPw ? <EyeOff size={15} /> : <Eye size={15} />}</button>
            </div>
          </div>
          <button onClick={handleLogin} disabled={loading} className="w-full rounded-xl bg-primary text-primary-foreground py-3.5 font-bold text-sm tracking-wide hover:opacity-90 transition-opacity disabled:opacity-60" style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.06em" }}>
            {loading ? "Signing in…" : "ACCESS MY POS"}
          </button>
          <div className="mt-4 text-center text-xs text-muted-foreground">
            <p>Need access? Ask your superadmin to create your business and owner account.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STAFF PIN SELECTOR
// ─────────────────────────────────────────────────────────────────────────────

function StaffSelector({ tenant, onSelect, onBack }: { tenant: Tenant; onSelect: (staffId: string) => void; onBack: () => void; }) {
  const [selected, setSelected] = useState<StaffMember | null>(null);
  const [pin, setPin] = useState(""); const [error, setError] = useState(false);

  function tryPin(p: string) {
    if (!selected) return;
    if (selected.pin === p) { onSelect(selected.id); }
    else { setError(true); setPin(""); setTimeout(() => setError(false), 1200); }
  }

  function pressDigit(d: string) {
    const np = pin + d;
    setPin(np);
    if (np.length === 4) setTimeout(() => tryPin(np), 100);
  }

  if (selected) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4" style={{ fontFamily: "'Barlow', sans-serif" }}>
        <div className="w-72 text-center">
          <button onClick={() => { setSelected(null); setPin(""); }} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8 mx-auto transition-colors"><ArrowLeft size={14} /> Back</button>
          <TenantBrandMark businessInfo={tenant.businessInfo} size="md" className="mx-auto mb-3" />
          <div className="w-14 h-14 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center mx-auto mb-3"><span className="text-primary text-xl font-bold">{selected.name[0]}</span></div>
          <p className="text-lg font-bold mb-1">{selected.name}</p>
          <p className="text-xs text-muted-foreground mb-6 capitalize">{selected.role}</p>
          <div className={`flex justify-center gap-3 mb-6 ${error ? "animate-pulse" : ""}`}>
            {[0,1,2,3].map((i) => <div key={i} className={`w-4 h-4 rounded-full transition-all ${i < pin.length ? error ? "bg-red-500" : "bg-primary" : "bg-white/15"}`} />)}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((d, i) => (
              <button key={i} onClick={() => d === "⌫" ? setPin((p) => p.slice(0,-1)) : d && pressDigit(d)} disabled={!d && d !== "0"}
                className={`rounded-xl py-4 text-lg font-bold transition-all active:scale-95 ${d ? "bg-white/8 hover:bg-white/15 text-foreground" : "opacity-0 pointer-events-none"}`}
                style={{ fontFamily: "'DM Mono', monospace" }}>{d}</button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4" style={{ fontFamily: "'Barlow', sans-serif" }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <TenantBrandMark businessInfo={tenant.businessInfo} size="md" className="mx-auto mb-3" />
          <h2 className="text-2xl font-black" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>{tenant.businessInfo.name.toUpperCase()}</h2>
          <p className="text-sm text-muted-foreground mt-1">Who is working today?</p>
        </div>
        <div className="space-y-2">
          {tenant.staff.map((s) => (
            <button key={s.id} onClick={() => { setSelected(s); setPin(""); }} className="w-full flex items-center gap-3 rounded-xl border border-border bg-card/30 hover:bg-card/60 hover:border-primary/25 px-4 py-3.5 transition-all">
              <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0"><span className="text-primary font-bold text-sm">{s.name[0]}</span></div>
              <div className="text-left flex-1"><p className="text-sm font-semibold">{s.name}</p><p className="text-xs text-muted-foreground capitalize">{s.role}</p></div>
              <ChevronRight size={15} className="text-muted-foreground" />
            </button>
          ))}
        </div>
        <button onClick={onBack} className="w-full mt-4 text-xs text-muted-foreground hover:text-foreground transition-colors py-2">Not your venue? Sign out</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RECEIPT MODAL
// ─────────────────────────────────────────────────────────────────────────────

function ReceiptModal({ sale, businessInfo, onClose }: { sale: SaleRecord; businessInfo: BusinessInfo; onClose: () => void; }) {
  const printRef = useRef<HTMLDivElement>(null);
  function handlePrint() {
    const w = window.open("", "_blank", "width=420,height=640");
    if (!w) return;
    const logo = businessInfo.logo ? `<img src="${businessInfo.logo}" style="height:40px;display:block;margin:0 auto 8px;" />` : "";
    w.document.write(`<html><head><title>Receipt</title><style>body{font-family:'Courier New',monospace;font-size:12px;width:300px;margin:0 auto;padding:16px}h2{font-size:14px;text-align:center;margin:0}p{margin:2px 0}.c{text-align:center}.s{font-size:10px;color:#555}.line{border-top:1px dashed #000;margin:8px 0}.row{display:flex;justify-content:space-between}.bold{font-weight:bold}</style></head><body>${logo}${printRef.current?.innerHTML ?? ""}</body></html>`);
    w.document.close(); w.focus(); w.print(); w.close();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-[360px] max-h-[90vh] rounded-2xl border border-amber-900/30 bg-[#161210] shadow-2xl flex flex-col" style={{ fontFamily: "'Barlow', sans-serif" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-amber-900/20 shrink-0"><h2 className="font-bold" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>Receipt</h2><button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 transition-colors"><X size={16} /></button></div>
        <div className="flex-1 overflow-y-auto px-5 py-4 text-sm">
          <div ref={printRef}>
            <h2>{businessInfo.name}</h2>
            {businessInfo.address && <p className="c s">{businessInfo.address}</p>}
            {businessInfo.phone && <p className="c s">{businessInfo.phone}</p>}
            <p className="c s">{fmtDate(sale.timestamp)} · {fmtTime(sale.timestamp)}</p>
            <p className="c s">Tab: {sale.tabName}</p>
            <div className="line" />
            {sale.items.map((o, i) => <div key={i} className="row"><span>{o.qty}× {o.menuItem.name}</span><span>{sale.currencySymbol}{(o.menuItem.price * o.qty).toFixed(2)}</span></div>)}
            <div className="line" />
            <div className="row"><span>Subtotal</span><span>{sale.currencySymbol}{sale.subtotal.toFixed(2)}</span></div>
            {sale.tax > 0 && <div className="row"><span>VAT</span><span>{sale.currencySymbol}{sale.tax.toFixed(2)}</span></div>}
            <div className="line" />
            <div className="row bold"><span>TOTAL</span><span>{sale.currencySymbol}{sale.totalConverted.toFixed(2)}</span></div>
            {sale.prepaid && <><div className="row"><span>Prepaid</span><span>{sale.currencySymbol}{sale.prepaid.toFixed(2)}</span></div>{sale.change != null && <div className="row bold"><span>Change</span><span>{sale.currencySymbol}{sale.change.toFixed(2)}</span></div>}</>}
            <div className="line" />
            <p className="c s">Paid via {sale.paymentMethod}</p>
            {businessInfo.vatNumber && <p className="c s">VAT No: {businessInfo.vatNumber}</p>}
            <p className="c s">Thank you for visiting {businessInfo.name}!</p>
          </div>
        </div>
        <div className="px-5 pb-5 pt-3 border-t border-amber-900/20 flex gap-2 shrink-0">
          <button onClick={handlePrint} className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-3 text-sm font-bold hover:opacity-90" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}><Printer size={14} /> PRINT RECEIPT</button>
          <button onClick={onClose} className="flex-1 rounded-xl border border-border text-muted-foreground py-3 text-sm hover:text-foreground hover:bg-white/5 transition-colors">Skip</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT MODAL
// ─────────────────────────────────────────────────────────────────────────────

function PaymentModal({ tab, tenant, staffId, onClose, onComplete }: { tab: Tab; tenant: Tenant; staffId: string; onClose: () => void; onComplete: (s: SaleRecord) => void; }) {
  const { config } = tenant;
  const enabledMethods = config.paymentMethods.filter((m) => m.enabled);
  const enabledCurrencies = config.currencies.filter((c) => c.enabled);
  const [method, setMethod] = useState(enabledMethods[0]?.id ?? "");
  const [currencyCode, setCurrencyCode] = useState(config.defaultCurrencyCode);
  const [cashInput, setCashInput] = useState(tab.prepaid ? String(tab.prepaid) : "");

  useEffect(() => {
    if (!enabledMethods.length) {
      setMethod("");
      return;
    }
    if (!enabledMethods.some((m) => m.id === method)) {
      setMethod(enabledMethods[0].id);
    }
  }, [enabledMethods, method]);

  const currency = enabledCurrencies.find((c) => c.code === currencyCode) ?? enabledCurrencies[0];
  const subtotal = calcSubtotal(tab.orders);
  const tax = calcTax(subtotal, config);
  const total = subtotal + tax;
  const totalConverted = total * (currency?.rate ?? 1);
  const cashAmount = parseFloat(cashInput) || 0;
  const change = cashAmount - totalConverted;
  const isCash = method === "cash";
  const canCharge = enabledMethods.length > 0 && (!isCash || cashAmount >= totalConverted);

  function handleCharge() {
    const sale: SaleRecord = {
      id: uid(), tabName: tab.name, items: tab.orders, subtotal, tax, total, totalConverted,
      paymentMethod: enabledMethods.find((m) => m.id === method)?.name ?? method,
      currencyCode: currency?.code ?? "ZAR", currencySymbol: currency?.symbol ?? "R",
      timestamp: new Date(), staffId, prepaid: tab.prepaid, customerId: tab.customerId,
      change: isCash && cashAmount > totalConverted ? parseFloat((cashAmount - totalConverted).toFixed(2)) : undefined,
    };
    onComplete(sale);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-[480px] max-h-[90vh] rounded-2xl border border-amber-900/30 bg-[#161210] shadow-2xl flex flex-col" style={{ fontFamily: "'Barlow', sans-serif" }}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-amber-900/20 shrink-0">
          <div><p className="text-[10px] tracking-widest text-muted-foreground uppercase" style={{ fontFamily: "'DM Mono', monospace" }}>{tab.prepaid ? "Pre-Paid Tab" : "Checkout"}</p><h2 className="text-xl font-bold" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>{tab.name}</h2></div>
          <button onClick={onClose} className="p-2 text-muted-foreground hover:text-foreground transition-colors"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 pt-4 pb-2 max-h-28 overflow-y-auto space-y-1">
            {tab.orders.map((o) => <div key={o.menuItem.id} className="flex justify-between text-sm"><span className="text-muted-foreground">{o.qty}× {o.menuItem.name}</span><span style={{ fontFamily: "'DM Mono', monospace" }}>{currency ? fmt(o.menuItem.price * o.qty, currency) : `R${(o.menuItem.price * o.qty).toFixed(2)}`}</span></div>)}
          </div>
          <div className="mx-6 mt-2 mb-4 rounded-xl bg-white/3 border border-amber-900/10 px-4 py-3 space-y-1">
            <div className="flex justify-between text-sm text-muted-foreground"><span>Subtotal</span><span style={{ fontFamily: "'DM Mono', monospace" }}>{currency ? fmt(subtotal, currency) : `R${subtotal.toFixed(2)}`}</span></div>
            {tax > 0 && <div className="flex justify-between text-sm text-muted-foreground"><span>VAT ({config.vatRate}%)</span><span style={{ fontFamily: "'DM Mono', monospace" }}>{currency ? fmt(tax, currency) : `R${tax.toFixed(2)}`}</span></div>}
            {!config.vatEnabled && <p className="text-xs text-muted-foreground flex items-center gap-1"><Info size={11} /> VAT disabled</p>}
            <div className="flex justify-between font-bold border-t border-amber-900/15 pt-1.5 mt-1"><span className="text-foreground">Total</span><span className="text-primary text-lg" style={{ fontFamily: "'DM Mono', monospace" }}>{currency ? fmt(total, currency) : `R${total.toFixed(2)}`}</span></div>
            {tab.prepaid && tab.prepaid > 0 && (
              <div className={`flex justify-between text-sm font-bold pt-1 border-t border-amber-900/15 ${tab.prepaid >= totalConverted ? "text-green-400" : "text-red-400"}`}>
                <span>{tab.prepaid >= totalConverted ? "Change Due" : "Balance Owed"}</span>
                <span style={{ fontFamily: "'DM Mono', monospace" }}>{currency?.symbol ?? "R"}{Math.abs(tab.prepaid - totalConverted).toFixed(2)}</span>
              </div>
            )}
          </div>
          {enabledCurrencies.length > 1 && (
            <div className="px-6 mb-4">
              <p className="text-[10px] tracking-widest text-muted-foreground uppercase mb-2" style={{ fontFamily: "'DM Mono', monospace" }}>Currency</p>
              <div className="flex flex-wrap gap-1.5">{enabledCurrencies.map((c) => <button key={c.code} onClick={() => { setCurrencyCode(c.code); setCashInput(""); }} className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${currencyCode === c.code ? "bg-primary text-primary-foreground" : "bg-white/5 text-muted-foreground hover:text-foreground"}`} style={{ fontFamily: "'DM Mono', monospace" }}>{c.symbol} {c.code}</button>)}</div>
            </div>
          )}
          <div className="px-6 mb-4">
            <p className="text-[10px] tracking-widest text-muted-foreground uppercase mb-2" style={{ fontFamily: "'DM Mono', monospace" }}>Payment Method</p>
            {enabledMethods.length === 0 ? (
              <div className="rounded-lg border border-red-900/30 bg-red-900/10 px-3 py-2 text-xs text-red-300">
                No payment methods are enabled. Ask admin to enable at least one in Admin - Payments.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {enabledMethods.map((m) => { const Icon = PAYMENT_ICONS[m.icon] ?? CreditCard; return <button key={m.id} onClick={() => setMethod(m.id)} className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all ${method === m.id ? "bg-primary text-primary-foreground" : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground"}`}><Icon size={14} /><span className="truncate">{m.name}</span></button>; })}
              </div>
            )}
          </div>
          {isCash && (
            <div className="px-6 mb-4">
              <label className="text-[10px] tracking-widest text-muted-foreground uppercase mb-2 block" style={{ fontFamily: "'DM Mono', monospace" }}>Cash Tendered ({currency?.symbol ?? "R"})</label>
              <input type="number" value={cashInput} onChange={(e) => setCashInput(e.target.value)} placeholder={`${currency?.symbol ?? "R"}0.00`} className="w-full rounded-lg bg-white/5 border border-amber-900/20 px-4 py-3 text-foreground text-lg font-semibold focus:outline-none focus:border-primary/50 transition-colors" style={{ fontFamily: "'DM Mono', monospace" }} />
              {cashAmount >= totalConverted && cashInput && <div className="flex justify-between text-sm mt-2"><span className="text-muted-foreground">Change due</span><span className="text-green-400 font-bold" style={{ fontFamily: "'DM Mono', monospace" }}>{currency?.symbol ?? "R"}{change.toFixed(2)}</span></div>}
              {cashInput && cashAmount < totalConverted && <div className="flex items-center gap-1 text-xs text-red-400 mt-2"><AlertCircle size={12} /> Short by {currency?.symbol ?? "R"}{(totalConverted - cashAmount).toFixed(2)}</div>}
            </div>
          )}
        </div>
        <div className="px-6 pb-6 pt-2 shrink-0">
          <button onClick={handleCharge} disabled={!canCharge} className="w-full rounded-xl bg-primary text-primary-foreground py-4 font-bold tracking-widest transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            {isCash ? "COMPLETE CASH PAYMENT" : `CHARGE ${currency ? fmt(total, currency) : `R${total.toFixed(2)}`}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NEW TAB MODAL (with pre-pay option)
// ─────────────────────────────────────────────────────────────────────────────

function NewTabModal({ tenant, onClose, onCreate }: { tenant: Tenant; onClose: () => void; onCreate: (name: string, prepaid?: number, customerId?: string) => void; }) {
  const [name, setName] = useState(""); const [payFirst, setPayFirst] = useState(false);
  const [prepaidInput, setPrepaidInput] = useState(""); const [customerId, setCustomerId] = useState("");
  const zarSymbol = tenant.config.currencies.find((c) => c.code === "ZAR")?.symbol ?? "R";

  function submit() {
    if (!name.trim()) return;
    const prepaid = payFirst && prepaidInput ? parseFloat(prepaidInput) : undefined;
    onCreate(name.trim(), prepaid, customerId || undefined);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-96 rounded-2xl border border-amber-900/30 bg-[#161210] shadow-2xl p-6" style={{ fontFamily: "'Barlow', sans-serif" }}>
        <h2 className="text-lg font-bold mb-4" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>Open New Tab</h2>
        <div className="space-y-3">
          <div><label className="text-xs text-muted-foreground mb-1 block">Name / Table *</label><input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Guest name or table number" className="w-full rounded-lg bg-white/5 border border-border px-4 py-3 text-sm text-foreground focus:outline-none focus:border-primary/50" /></div>
          {tenant.customers.length > 0 && <div><label className="text-xs text-muted-foreground mb-1 block">Link Customer (optional)</label><select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className="w-full rounded-lg bg-[#1a1510] border border-border px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50"><option value="">— Walk-in —</option>{tenant.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
          <div className="rounded-xl border border-border bg-white/3 p-3">
            <div className="flex items-center justify-between">
              <div><p className="text-sm font-semibold">Pre-Pay / Deposit</p><p className="text-xs text-muted-foreground">Customer pays upfront; track balance as items are added</p></div>
              <button onClick={() => setPayFirst((v) => !v)} className={`w-11 h-6 rounded-full relative shrink-0 ${payFirst ? "bg-primary" : "bg-white/10"}`}><span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${payFirst ? "left-[22px]" : "left-0.5"}`} /></button>
            </div>
            {payFirst && <div className="mt-3"><label className="text-xs text-muted-foreground mb-1 block">Amount ({zarSymbol})</label><input type="number" value={prepaidInput} onChange={(e) => setPrepaidInput(e.target.value)} placeholder={`${zarSymbol}0.00`} className="w-full rounded-lg bg-white/5 border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50" style={{ fontFamily: "'DM Mono', monospace" }} /></div>}
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 rounded-lg border border-border py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
          <button onClick={submit} disabled={!name.trim()} className="flex-1 rounded-lg bg-primary text-primary-foreground py-2.5 text-sm font-semibold disabled:opacity-30 hover:opacity-90">Open Tab</button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SALES SECTION
// ─────────────────────────────────────────────────────────────────────────────

function SalesSection({ sales }: { sales: SaleRecord[] }) {
  const allDates = Array.from(new Set(sales.map((s) => dateKey(s.timestamp)))).sort((a, b) => b.localeCompare(a));
  const [selectedDate, setSelectedDate] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = selectedDate === "all" ? sales : sales.filter((s) => dateKey(s.timestamp) === selectedDate);
  const sorted = [...filtered].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  const totalRevenue = filtered.reduce((s, r) => s + r.total, 0);
  const totalItems = filtered.reduce((s, r) => s + r.items.reduce((q, i) => q + i.qty, 0), 0);
  const totalTax = filtered.reduce((s, r) => s + r.tax, 0);

  const itemMap: Record<string, { name: string; qty: number; revenue: number }> = {};
  filtered.forEach((sale) => sale.items.forEach((o) => { if (!itemMap[o.menuItem.id]) itemMap[o.menuItem.id] = { name: o.menuItem.name, qty: 0, revenue: 0 }; itemMap[o.menuItem.id].qty += o.qty; itemMap[o.menuItem.id].revenue += o.menuItem.price * o.qty; }));
  const topItems = Object.values(itemMap).sort((a, b) => b.qty - a.qty).slice(0, 5);
  const payBreak: Record<string, number> = {};
  filtered.forEach((s) => { payBreak[s.paymentMethod] = (payBreak[s.paymentMethod] ?? 0) + s.total; });

  function labelDate(k: string) {
    if (k === "all") return "All Time";
    const today = dateKey(new Date()); const yesterday = dateKey(new Date(Date.now() - 86400000));
    if (k === today) return "Today"; if (k === yesterday) return "Yesterday";
    return fmtDate(new Date(k + "T12:00:00"));
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div><h2 className="text-xl font-bold" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>Sales</h2><p className="text-xs text-muted-foreground">{filtered.length} transactions · {labelDate(selectedDate)}</p></div>
        <div className="flex items-center gap-2"><Calendar size={13} className="text-muted-foreground" /><div className="relative"><select value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="appearance-none rounded-lg bg-[#1a1510] border border-border pl-3 pr-8 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 cursor-pointer"><option value="all">All Time</option>{allDates.map((d) => <option key={d} value={d}>{labelDate(d)}</option>)}</select><ChevronDown size={13} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" /></div></div>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[{ label: "Revenue", value: `R${totalRevenue.toFixed(2)}`, icon: TrendingUp, color: "text-primary" }, { label: "Items Sold", value: totalItems.toString(), icon: Package, color: "text-blue-400" }, { label: "VAT", value: `R${totalTax.toFixed(2)}`, icon: Percent, color: "text-amber-400" }].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-xl border border-border bg-card/40 px-4 py-3"><div className="flex items-center gap-1.5 mb-1"><Icon size={12} className={color} /><span className="text-[10px] text-muted-foreground uppercase tracking-widest" style={{ fontFamily: "'DM Mono', monospace" }}>{label}</span></div><p className={`text-xl font-bold ${color}`} style={{ fontFamily: "'DM Mono', monospace" }}>{value}</p></div>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-4 mb-5">
        <div className="col-span-3 rounded-xl border border-border bg-card/30 p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-3" style={{ fontFamily: "'DM Mono', monospace" }}>Top Items</p>
          {topItems.length === 0 ? <p className="text-xs text-muted-foreground">No data.</p> : topItems.map((item, i) => (
            <div key={item.name} className="flex items-center gap-2 mb-2"><span className="text-xs text-muted-foreground w-4 text-right" style={{ fontFamily: "'DM Mono', monospace" }}>{i+1}</span><div className="flex-1"><div className="flex justify-between mb-0.5"><span className="text-xs font-medium">{item.name}</span><span className="text-xs text-muted-foreground" style={{ fontFamily: "'DM Mono', monospace" }}>{item.qty}×</span></div><div className="h-1 rounded-full bg-white/5"><div className="h-full rounded-full bg-primary/60" style={{ width: `${(item.qty / (topItems[0]?.qty || 1)) * 100}%` }} /></div></div></div>
          ))}
        </div>
        <div className="col-span-2 rounded-xl border border-border bg-card/30 p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-3" style={{ fontFamily: "'DM Mono', monospace" }}>By Method</p>
          {Object.entries(payBreak).length === 0 ? <p className="text-xs text-muted-foreground">No data.</p> : Object.entries(payBreak).sort(([,a],[,b]) => b-a).map(([m, amount]) => <div key={m} className="flex justify-between items-center mb-1.5"><span className="text-xs text-muted-foreground truncate">{m}</span><span className="text-xs font-semibold" style={{ fontFamily: "'DM Mono', monospace" }}>R{amount.toFixed(0)}</span></div>)}
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-2" style={{ fontFamily: "'DM Mono', monospace" }}>Transactions</p>
      {sorted.length === 0 ? <div className="rounded-xl border border-border bg-card/20 p-8 text-center"><BarChart2 size={28} className="text-muted-foreground/20 mx-auto mb-2" /><p className="text-sm text-muted-foreground">No transactions.</p></div> : (
        <div className="space-y-1.5">
          {sorted.map((sale) => (
            <div key={sale.id} className="rounded-xl border border-border bg-card/30 overflow-hidden">
              <button onClick={() => setExpandedId(expandedId === sale.id ? null : sale.id)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/3 transition-colors text-left">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap"><p className="text-sm font-semibold">{sale.tabName}</p><span className="text-[10px] text-muted-foreground bg-white/5 rounded px-1.5 py-0.5">{sale.paymentMethod}</span>{sale.prepaid && <span className="text-[10px] text-green-400 bg-green-400/10 rounded px-1.5 py-0.5">Pre-paid</span>}</div>
                  <p className="text-xs text-muted-foreground" style={{ fontFamily: "'DM Mono', monospace" }}>{fmtDate(sale.timestamp)} · {fmtTime(sale.timestamp)}</p>
                </div>
                <div className="text-right shrink-0"><p className="text-sm font-bold" style={{ fontFamily: "'DM Mono', monospace" }}>R{sale.total.toFixed(2)}</p><p className="text-[10px] text-muted-foreground">{sale.items.reduce((q,i)=>q+i.qty,0)} items</p></div>
                <ChevronDown size={14} className={`text-muted-foreground transition-transform shrink-0 ${expandedId === sale.id ? "rotate-180" : ""}`} />
              </button>
              {expandedId === sale.id && <div className="px-4 pb-3 border-t border-border/50 pt-2 space-y-1">{sale.items.map((o,i) => <div key={i} className="flex justify-between text-xs text-muted-foreground"><span>{o.qty}× {o.menuItem.name}</span><span style={{ fontFamily: "'DM Mono', monospace" }}>R{(o.menuItem.price*o.qty).toFixed(2)}</span></div>)}{sale.tax > 0 && <div className="flex justify-between text-xs text-muted-foreground border-t border-border/30 pt-1"><span>VAT</span><span style={{ fontFamily: "'DM Mono', monospace" }}>R{sale.tax.toFixed(2)}</span></div>}{sale.change != null && <div className="flex justify-between text-xs text-green-400 pt-0.5"><span>Change given</span><span style={{ fontFamily: "'DM Mono', monospace" }}>R{sale.change.toFixed(2)}</span></div>}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN PANEL
// ─────────────────────────────────────────────────────────────────────────────

function AdminPanel({ tenant, currentStaffId, onTenantChange, onBack }: { tenant: Tenant; currentStaffId: string; onTenantChange: (t: Tenant) => void; onBack: () => void; }) {
  const [section, setSection] = useState<AdminSection>("products");
  const [editingProduct, setEditingProduct] = useState<MenuItem | null>(null);
  const [bizSaved, setBizSaved] = useState(false);
  const [newCatName, setNewCatName] = useState(""); const [newPayName, setNewPayName] = useState(""); const [newPayIcon, setNewPayIcon] = useState("card");
  const [newStaffName, setNewStaffName] = useState(""); const [newStaffPin, setNewStaffPin] = useState(""); const [newStaffRole, setNewStaffRole] = useState<StaffMember["role"]>("bartender");
  const [newCustName, setNewCustName] = useState(""); const [newCustEmail, setNewCustEmail] = useState(""); const [newCustPhone, setNewCustPhone] = useState(""); const [editingCust, setEditingCust] = useState<Customer | null>(null);
  const [newPrinterName, setNewPrinterName] = useState("");
  const [newPrinterConnection, setNewPrinterConnection] = useState<HardwareDevice["connection"]>("usb");
  const [newPrinterTarget, setNewPrinterTarget] = useState("");
  const [newScannerName, setNewScannerName] = useState("");
  const [newScannerConnection, setNewScannerConnection] = useState<HardwareDevice["connection"]>("usb");
  const [newScannerTarget, setNewScannerTarget] = useState("");
  const logoRef = useRef<HTMLInputElement>(null);

  const { config, businessInfo, menu } = tenant;
  const currentStaff = tenant.staff.find((s) => s.id === currentStaffId) ?? null;
  const currentPermissions = currentStaff?.permissions ?? defaultPermissionsForRole(currentStaff?.role ?? "bartender");
  const emptyProduct = (): MenuItem => ({ id: uid(), name: "", category: config.categories.find((c) => c.enabled)?.name ?? "Cocktails", price: 0, description: "", stock: -1 });
  const [productForm, setProductForm] = useState<MenuItem>(emptyProduct());
  const [bizForm, setBizForm] = useState<BusinessInfo>({ ...businessInfo });

  const update = useCallback((patch: Partial<Tenant>) => onTenantChange({ ...tenant, ...patch }), [tenant, onTenantChange]);
  const updateConfig = useCallback((cfg: Partial<TenantConfig>) => update({ config: { ...config, ...cfg } }), [config, update]);

  useEffect(() => {
    setBizForm({ ...businessInfo });
  }, [businessInfo]);

  function saveProduct() {
    if (!productForm.name.trim() || productForm.price <= 0) return;
    const newMenu = editingProduct ? menu.map((m) => m.id === editingProduct.id ? productForm : m) : [...menu, { ...productForm, id: uid() }];
    update({ menu: newMenu }); setEditingProduct(null); setProductForm(emptyProduct());
  }

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const logo = ev.target?.result as string;
      setBizForm((current) => {
        const next = { ...current, logo };
        update({ businessInfo: next });
        return next;
      });
      e.target.value = "";
    };
    reader.readAsDataURL(file);
  }

  function saveBusinessInfo() {
    const trimmedName = bizForm.name.trim();
    if (!trimmedName) return;
    const next = { ...bizForm, name: trimmedName };
    setBizForm(next);
    update({ businessInfo: next });
    setBizSaved(true);
    setTimeout(() => setBizSaved(false), 2000);
  }

  const printers = config.printers ?? [];
  const scanners = config.scanners ?? [];
  const enabledCats = config.categories.filter((c) => c.enabled).map((c) => c.name);
  const permissionLabels: Array<{ key: StaffPermissionKey; label: string }> = [
    { key: "adminAccess", label: "Admin Access" },
    { key: "editProducts", label: "Edit Products" },
    { key: "editCategories", label: "Edit Categories" },
    { key: "editPayments", label: "Edit Payments" },
    { key: "editCurrencies", label: "Edit Currencies" },
    { key: "editVat", label: "Edit VAT" },
    { key: "editBusiness", label: "Edit Business Info" },
    { key: "manageStaff", label: "Manage Staff" },
    { key: "manageCustomers", label: "Manage Customers" },
    { key: "viewSales", label: "View Sales" },
    { key: "manageSystem", label: "System Settings" },
    { key: "openTabs", label: "Open/Close Tabs" },
    { key: "editOrders", label: "Add/Edit Orders" },
    { key: "chargeTabs", label: "Charge Tabs" },
    { key: "useClientDisplay", label: "Client Display" },
  ];

  const navItems: { id: AdminSection; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
    { id: "products", label: "Products", icon: Package }, { id: "categories", label: "Categories", icon: Tag },
    { id: "payment-methods", label: "Payments", icon: CreditCard }, { id: "currencies", label: "Currencies", icon: Globe },
    { id: "vat", label: "VAT", icon: Percent }, { id: "business", label: "Business", icon: Store },
    { id: "staff", label: "Staff", icon: Shield }, { id: "customers", label: "Customers", icon: UserCheck },
    { id: "sales", label: "Sales", icon: BarChart2 }, { id: "system", label: "System", icon: Info },
  ];

  const sectionAllowed: Record<AdminSection, boolean> = {
    products: currentPermissions.editProducts,
    categories: currentPermissions.editCategories,
    "payment-methods": currentPermissions.editPayments,
    currencies: currentPermissions.editCurrencies,
    vat: currentPermissions.editVat,
    business: currentPermissions.editBusiness,
    staff: currentPermissions.manageStaff,
    customers: currentPermissions.manageCustomers,
    sales: currentPermissions.viewSales,
    system: currentPermissions.manageSystem,
  };

  const allowedNavItems = navItems.filter((item) => sectionAllowed[item.id]);

  useEffect(() => {
    if (!sectionAllowed[section]) {
      setSection(allowedNavItems[0]?.id ?? "system");
    }
  }, [section, allowedNavItems, sectionAllowed]);

  if (!currentPermissions.adminAccess) {
    return (
      <div className="h-screen w-screen flex flex-col bg-background text-foreground" style={{ fontFamily: "'Barlow', sans-serif" }}>
        <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-card/60 shrink-0">
          <div className="flex items-center gap-3">
            <TenantBrandMark businessInfo={tenant.businessInfo} size="sm" />
            <span className="hidden sm:block text-sm font-bold tracking-wide" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>{tenant.businessInfo.name.toUpperCase()}</span>
            <span className="text-muted-foreground/30 hidden sm:block">|</span>
            <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"><ArrowLeft size={15} /> POS</button>
          </div>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded border text-muted-foreground border-border" style={{ fontFamily: "'DM Mono', monospace" }}>ACCESS CONTROL</span>
        </header>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md rounded-xl border border-border bg-card/30 p-6 text-center">
            <Shield size={22} className="text-primary mx-auto mb-3" />
            <h2 className="text-lg font-bold mb-2" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>Admin Access Restricted</h2>
            <p className="text-sm text-muted-foreground">Only staff with admin permission can open company settings.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-foreground" style={{ fontFamily: "'Barlow', sans-serif" }}>
      <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-card/60 shrink-0">
        <div className="flex items-center gap-3">
          <TenantBrandMark businessInfo={tenant.businessInfo} size="sm" />
          <span className="hidden sm:block text-sm font-bold tracking-wide" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>{tenant.businessInfo.name.toUpperCase()}</span>
          <span className="text-muted-foreground/30 hidden sm:block">|</span>
          <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"><ArrowLeft size={15} /> POS</button>
          <span className="text-muted-foreground/30">|</span>
          <span className="text-primary text-sm font-bold tracking-widest" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>ADMIN</span>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded border text-muted-foreground border-border" style={{ fontFamily: "'DM Mono', monospace" }}>MANAGED ACCOUNT</span>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-44 shrink-0 border-r border-border bg-card/30 flex flex-col py-3 gap-0.5 px-2 overflow-y-auto">
          {allowedNavItems.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => { setSection(id); setEditingProduct(null); setProductForm(emptyProduct()); }} className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${section === id ? "bg-primary/15 text-primary border border-primary/20" : "text-muted-foreground hover:text-foreground hover:bg-white/5"}`}><Icon size={14} /> {label}</button>
          ))}
        </aside>
        <main className="flex-1 overflow-y-auto p-6">

          {section === "products" && (
            <div className="max-w-4xl">
              <div className="flex items-center justify-between mb-4"><h2 className="text-xl font-bold" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>{editingProduct ? "Edit Product" : "Products"}</h2>{!editingProduct && <button onClick={() => { setProductForm(emptyProduct()); setEditingProduct(null); }} className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:opacity-90"><Plus size={14} /> Add</button>}</div>
              <div className="rounded-xl border border-border bg-card/40 p-5 mb-5">
                <p className="text-xs font-semibold text-muted-foreground mb-4 uppercase tracking-widest" style={{ fontFamily: "'DM Mono', monospace" }}>{editingProduct ? `Editing: ${editingProduct.name}` : "New Product"}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs text-muted-foreground mb-1 block">Name *</label><input value={productForm.name} onChange={(e) => setProductForm({...productForm, name: e.target.value})} placeholder="Product name" className="w-full rounded-lg bg-white/5 border border-border px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50" /></div>
                  <div><label className="text-xs text-muted-foreground mb-1 block">Category</label><select value={productForm.category} onChange={(e) => setProductForm({...productForm, category: e.target.value})} className="w-full rounded-lg bg-[#1a1510] border border-border px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50">{enabledCats.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
                  <div><label className="text-xs text-muted-foreground mb-1 block">Price (ZAR) *</label><input type="number" min="0" value={productForm.price || ""} onChange={(e) => setProductForm({...productForm, price: parseFloat(e.target.value)||0})} placeholder="0.00" className="w-full rounded-lg bg-white/5 border border-border px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50" /></div>
                  <div><label className="text-xs text-muted-foreground mb-1 block">Stock (-1 = ∞)</label><input type="number" min="-1" value={productForm.stock} onChange={(e) => setProductForm({...productForm, stock: parseInt(e.target.value)??-1})} className="w-full rounded-lg bg-white/5 border border-border px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50" /></div>
                  <div className="col-span-2"><label className="text-xs text-muted-foreground mb-1 block">Description</label><input value={productForm.description} onChange={(e) => setProductForm({...productForm, description: e.target.value})} placeholder="Ingredients or details" className="w-full rounded-lg bg-white/5 border border-border px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50" /></div>
                  <div className="col-span-2 flex items-center gap-2"><input type="checkbox" id="pop" checked={!!productForm.popular} onChange={(e) => setProductForm({...productForm, popular: e.target.checked})} className="accent-amber-500 w-4 h-4" /><label htmlFor="pop" className="text-sm text-muted-foreground">Popular</label></div>
                </div>
                <div className="flex gap-2 mt-4">
                  <button onClick={saveProduct} disabled={!productForm.name.trim()||productForm.price<=0} className="flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-30"><Save size={13} />{editingProduct ? "Save" : "Add"}</button>
                  {editingProduct && <button onClick={() => { setEditingProduct(null); setProductForm(emptyProduct()); }} className="rounded-lg border border-border px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground">Cancel</button>}
                </div>
              </div>
              {enabledCats.map((cat) => { const items = menu.filter((m) => m.category===cat); if (!items.length) return null; return (
                <div key={cat}>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1.5 mt-4" style={{ fontFamily: "'DM Mono', monospace" }}>{cat}</p>
                  {items.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 rounded-lg border border-border bg-card/30 px-4 py-2.5 mb-1 hover:bg-card/50">
                      <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{item.name}{item.stock===0&&<span className="ml-2 text-[10px] text-red-400 bg-red-400/10 px-1.5 py-0.5 rounded">OUT</span>}{item.popular&&<span className="ml-2 text-[10px] text-primary font-bold">● HOT</span>}</p><p className="text-xs text-muted-foreground truncate">{item.description}</p></div>
                      <span className="text-sm font-semibold shrink-0" style={{ fontFamily: "'DM Mono', monospace" }}>R{item.price.toFixed(2)}</span>
                      <span className={`text-xs shrink-0 ${item.stock===0?"text-red-400":item.stock===-1?"text-muted-foreground":"text-green-400"}`} style={{ fontFamily: "'DM Mono', monospace" }}>{item.stock===-1?"∞":`${item.stock}`}</span>
                      <button onClick={() => { setEditingProduct(item); setProductForm({...item}); }} className="p-1.5 text-muted-foreground hover:text-primary"><Edit2 size={13} /></button>
                      <button onClick={() => update({ menu: menu.filter((m) => m.id!==item.id) })} className="p-1.5 text-muted-foreground hover:text-red-400"><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              ); })}
            </div>
          )}

          {section === "categories" && (
            <div className="max-w-md">
              <h2 className="text-xl font-bold mb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>Categories</h2>
              <p className="text-sm text-muted-foreground mb-4">"All" is always present.</p>
              <div className="flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 mb-2"><span className="flex-1 text-sm font-medium">All</span><span className="text-[10px] text-primary bg-primary/15 rounded px-2 py-0.5 font-bold">ALWAYS ON</span></div>
              {config.categories.map((cat) => (
                <div key={cat.name} className={`flex items-center gap-3 rounded-xl border px-4 py-3 mb-1.5 ${cat.enabled?"border-primary/20 bg-primary/5":"border-border bg-card/30"}`}>
                  <span className={`flex-1 text-sm font-medium ${cat.enabled?"text-foreground":"text-muted-foreground"}`}>{cat.name}</span>
                  <span className="text-[10px] text-muted-foreground" style={{ fontFamily: "'DM Mono', monospace" }}>{menu.filter((m)=>m.category===cat.name).length} items</span>
                  <button onClick={() => { const en = config.categories.filter((c)=>c.enabled).length; if (cat.enabled && en<=1) return; updateConfig({ categories: config.categories.map((c)=>c.name===cat.name?{...c,enabled:!c.enabled}:c) }); }} className={`w-11 h-6 rounded-full relative ${cat.enabled?"bg-primary":"bg-white/10"}`}><span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${cat.enabled?"left-[22px]":"left-0.5"}`} /></button>
                  <button onClick={() => { updateConfig({ categories: config.categories.filter((c)=>c.name!==cat.name) }); update({ menu: menu.filter((m)=>m.category!==cat.name) }); }} className="p-1 text-muted-foreground hover:text-red-400"><Trash2 size={12} /></button>
                </div>
              ))}
              <div className="rounded-xl border border-dashed border-border p-4 mt-4">
                <p className="text-xs text-muted-foreground mb-2 uppercase tracking-widest" style={{ fontFamily: "'DM Mono', monospace" }}>Add Category</p>
                <div className="flex gap-2"><input value={newCatName} onChange={(e)=>setNewCatName(e.target.value)} onKeyDown={(e)=>{if(e.key==="Enter"&&newCatName.trim()){updateConfig({categories:[...config.categories,{name:newCatName.trim(),enabled:true}]});setNewCatName("");}}} placeholder="e.g. Mocktails" className="flex-1 rounded-lg bg-white/5 border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50" /><button onClick={()=>{if(!newCatName.trim())return;updateConfig({categories:[...config.categories,{name:newCatName.trim(),enabled:true}]});setNewCatName("");}} className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:opacity-90">Add</button></div>
              </div>
            </div>
          )}

          {section === "payment-methods" && (
            <div className="max-w-xl">
              <h2 className="text-xl font-bold mb-5" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>Payment Methods</h2>
              <div className="space-y-2 mb-5">
                {config.paymentMethods.map((m) => { const Icon = PAYMENT_ICONS[m.icon] ?? CreditCard; return (
                  <div key={m.id} className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${m.enabled?"border-primary/25 bg-primary/5":"border-border bg-card/30"}`}>
                    <Icon size={15} className={m.enabled?"text-primary":"text-muted-foreground"} />
                    <span className={`flex-1 text-sm font-medium ${m.enabled?"text-foreground":"text-muted-foreground"}`}>{m.name}</span>
                    {m.custom && <button onClick={()=>updateConfig({paymentMethods:config.paymentMethods.filter((pm)=>pm.id!==m.id)})} className="p-1 text-muted-foreground hover:text-red-400"><Trash2 size={13} /></button>}
                    <button onClick={()=>updateConfig({paymentMethods:config.paymentMethods.map((pm)=>pm.id===m.id?{...pm,enabled:!pm.enabled}:pm)})} className={`w-11 h-6 rounded-full relative ${m.enabled?"bg-primary":"bg-white/10"}`}><span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${m.enabled?"left-[22px]":"left-0.5"}`} /></button>
                  </div>
                ); })}
              </div>
              <div className="rounded-xl border border-dashed border-border p-4">
                <p className="text-xs text-muted-foreground mb-3 uppercase tracking-widest" style={{ fontFamily: "'DM Mono', monospace" }}>Add Custom</p>
                <div className="flex gap-2 mb-2"><input value={newPayName} onChange={(e)=>setNewPayName(e.target.value)} placeholder="Method name" className="flex-1 rounded-lg bg-white/5 border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50" /><select value={newPayIcon} onChange={(e)=>setNewPayIcon(e.target.value)} className="rounded-lg bg-[#1a1510] border border-border px-3 py-2 text-sm text-foreground focus:outline-none"><option value="card">💳 Card</option><option value="cash">💵 Cash</option><option value="qr">📱 QR</option><option value="bank">🏦 Bank</option><option value="mobile">📲 Mobile</option><option value="bitcoin">₿ Crypto</option><option value="zap">⚡ Other</option></select></div>
                <button onClick={()=>{if(!newPayName.trim())return;updateConfig({paymentMethods:[...config.paymentMethods,{id:uid(),name:newPayName.trim(),icon:newPayIcon,enabled:true,custom:true}]});setNewPayName("");}} disabled={!newPayName.trim()} className="w-full rounded-lg bg-primary/15 border border-primary/25 text-primary py-2 text-sm font-semibold hover:bg-primary/20 disabled:opacity-30">+ Add</button>
              </div>
            </div>
          )}

          {section === "currencies" && (
            <div className="max-w-xl">
              <h2 className="text-xl font-bold mb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>Currencies</h2>
              <p className="text-sm text-muted-foreground mb-5">Enable currencies and set exchange rates. Mark one as the checkout default.</p>
              <div className="space-y-2">
                {config.currencies.map((c) => { const isDefault = config.defaultCurrencyCode === c.code; return (
                  <div key={c.code} className={`rounded-xl border px-4 py-3 ${c.enabled?"border-primary/25 bg-primary/5":"border-border bg-card/30"}`}>
                    <div className="flex items-center gap-3">
                      <span className="text-base w-8 text-center" style={{ fontFamily: "'DM Mono', monospace" }}>{c.symbol}</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap"><p className={`text-sm font-semibold ${c.enabled?"text-foreground":"text-muted-foreground"}`}>{c.code} — {c.name}</p>{isDefault&&<span className="text-[10px] text-primary bg-primary/15 rounded px-1.5 py-0.5 font-bold flex items-center gap-0.5"><Star size={9} /> DEFAULT</span>}</div>
                        {c.code !== "ZAR" && c.enabled && (<div className="flex items-center gap-2 mt-1.5 flex-wrap"><span className="text-xs text-muted-foreground">1 ZAR =</span><input type="number" step="0.0001" value={c.rate} onChange={(e)=>updateConfig({currencies:config.currencies.map((cu)=>cu.code===c.code?{...cu,rate:parseFloat(e.target.value)||cu.rate}:cu)})} className="w-24 text-xs rounded bg-white/5 border border-border px-2 py-1 text-foreground focus:outline-none" style={{ fontFamily: "'DM Mono', monospace" }} /><span className="text-xs text-muted-foreground">{c.code}</span>{!isDefault&&<button onClick={()=>updateConfig({defaultCurrencyCode:c.code})} className="text-[10px] text-muted-foreground hover:text-primary border border-border rounded px-2 py-0.5">Set default</button>}</div>)}
                        {c.code === "ZAR" && !isDefault && <button onClick={()=>updateConfig({defaultCurrencyCode:"ZAR"})} className="mt-1 text-[10px] text-muted-foreground hover:text-primary border border-border rounded px-2 py-0.5">Set default</button>}
                      </div>
                      {c.code !== "ZAR" && <button onClick={()=>{const off=c.enabled;updateConfig({currencies:config.currencies.map((cu)=>cu.code===c.code?{...cu,enabled:!cu.enabled}:cu),defaultCurrencyCode:off&&config.defaultCurrencyCode===c.code?"ZAR":config.defaultCurrencyCode});}} className={`w-11 h-6 rounded-full relative shrink-0 ${c.enabled?"bg-primary":"bg-white/10"}`}><span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${c.enabled?"left-[22px]":"left-0.5"}`} /></button>}
                    </div>
                  </div>
                ); })}
              </div>
            </div>
          )}

          {section === "vat" && (
            <div className="max-w-md">
              <h2 className="text-xl font-bold mb-5" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>VAT Settings</h2>
              <div className="rounded-xl border border-border bg-card/30 p-5 mb-4">
                <div className="flex items-center justify-between"><div><p className="text-sm font-semibold">Apply VAT / Tax</p><p className="text-xs text-muted-foreground">Include VAT on all transactions</p></div><button onClick={()=>updateConfig({vatEnabled:!config.vatEnabled})} className={`w-12 h-6 rounded-full relative ${config.vatEnabled?"bg-primary":"bg-white/10"}`}><span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${config.vatEnabled?"left-[26px]":"left-0.5"}`} /></button></div>
              </div>
              {config.vatEnabled && (
                <div className="rounded-xl border border-border bg-card/30 p-5 mb-4">
                  <label className="text-xs text-muted-foreground uppercase tracking-widest mb-2 block" style={{ fontFamily: "'DM Mono', monospace" }}>VAT Rate</label>
                  <div className="flex items-center gap-3"><input type="number" min="0" max="100" step="0.5" value={config.vatRate} onChange={(e)=>updateConfig({vatRate:parseFloat(e.target.value)||0})} className="w-28 rounded-lg bg-white/5 border border-border px-4 py-3 text-foreground text-lg font-semibold focus:outline-none focus:border-primary/50" style={{ fontFamily: "'DM Mono', monospace" }} /><span className="text-2xl text-muted-foreground font-bold">%</span></div>
                  <p className="text-xs text-muted-foreground mt-2">South Africa standard rate: 15%</p>
                </div>
              )}
              <div className="rounded-xl border border-border bg-card/30 p-4">
                <p className="text-xs text-muted-foreground mb-2 uppercase tracking-widest" style={{ fontFamily: "'DM Mono', monospace" }}>Preview on R100</p>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Item</span><span style={{ fontFamily: "'DM Mono', monospace" }}>R100.00</span></div>
                  {config.vatEnabled&&<div className="flex justify-between"><span className="text-muted-foreground">VAT ({config.vatRate}%)</span><span style={{ fontFamily: "'DM Mono', monospace" }}>R{config.vatRate.toFixed(2)}</span></div>}
                  <div className="flex justify-between font-bold border-t border-border pt-1"><span>Total</span><span className="text-primary" style={{ fontFamily: "'DM Mono', monospace" }}>R{(100+(config.vatEnabled?config.vatRate:0)).toFixed(2)}</span></div>
                </div>
              </div>
            </div>
          )}

          {section === "business" && (
            <div className="max-w-lg">
              <h2 className="text-xl font-bold mb-5" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>Business Info</h2>
              <div className="rounded-xl border border-border bg-card/30 p-5 mb-4">
                <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3" style={{ fontFamily: "'DM Mono', monospace" }}>Logo</p>
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-xl border border-border bg-white/5 flex items-center justify-center overflow-hidden shrink-0">
                    {bizForm.logo ? <img src={bizForm.logo} alt="Logo" className="w-full h-full object-contain" /> : <span className="text-muted-foreground/40 text-2xl font-black" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>{bizForm.name.slice(0,2).toUpperCase()}</span>}
                  </div>
                  <div className="space-y-2">
                    <button onClick={()=>logoRef.current?.click()} className="flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm text-foreground hover:bg-white/5"><Upload size={14} /> Upload Logo</button>
                    {bizForm.logo && <button onClick={()=>{setBizForm((current)=>{const next={...current,logo:null};update({businessInfo:next});return next;});}} className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300"><Trash2 size={12} /> Remove</button>}
                    <p className="text-xs text-muted-foreground">PNG, JPG, SVG</p>
                  </div>
                </div>
                <input ref={logoRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
              </div>
              <div className="rounded-xl border border-border bg-card/30 p-5 space-y-3">
                {([["Business Name","name",Store,"Noir & Vine"],["Address","address",MapPin,"12 Long St, Cape Town"],["Phone","phone",Phone,"+27 21 123 4567"],["Email","email",Mail,"hello@yourvenue.co.za"],["Website","website",Globe,"yourvenue.co.za"],["Reg. Number","regNumber",Building2,"2019/123456/07"],["VAT Number","vatNumber",Percent,"4130123456"]] as [string, keyof BusinessInfo, React.ComponentType<{size?:number}>, string][]).map(([label, key, Icon, ph]) => (
                  <div key={key}><label className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5"><Icon size={11} />{label}</label><input value={bizForm[key] ?? ""} onChange={(e)=>setBizForm((b)=>({...b,[key]:e.target.value}))} placeholder={ph} className="w-full rounded-lg bg-white/5 border border-border px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-primary/50" /></div>
                ))}
                <button onClick={saveBusinessInfo} disabled={!bizForm.name.trim()} className={`w-full rounded-xl py-3 text-sm font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed ${bizSaved?"bg-green-600 text-white":"bg-primary text-primary-foreground hover:opacity-90"}`} style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>{bizSaved?<><Check size={14}/> SAVED</>:<><Save size={14}/> SAVE CHANGES</>}</button>
              </div>
            </div>
          )}

          {section === "staff" && (
            <div className="max-w-lg">
              <h2 className="text-xl font-bold mb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>Business Users</h2>
              <p className="text-sm text-muted-foreground mb-5">Company admins manage the users who can access this business.</p>
              <div className="space-y-2 mb-5">{tenant.staff.map((s) => { const staffPermissions = s.permissions ?? defaultPermissionsForRole(s.role); return <div key={s.id} className="rounded-xl border border-border bg-card/30 px-4 py-3"><div className="flex items-center gap-3"><div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0"><span className="text-primary text-sm font-bold">{s.name[0]}</span></div><div className="flex-1"><p className="text-sm font-semibold">{s.name}</p><p className="text-xs text-muted-foreground capitalize">{s.role} · PIN: ••••</p></div>{s.role!=="owner"&&<button onClick={()=>update({staff:tenant.staff.filter((st)=>st.id!==s.id)})} className="p-1.5 text-muted-foreground hover:text-red-400"><Trash2 size={13} /></button>}</div><div className="mt-3 grid grid-cols-2 gap-2">{permissionLabels.map(({ key, label }) => (<button key={key} disabled={s.role === "owner"} onClick={() => { if (s.role === "owner") return; update({ staff: tenant.staff.map((st) => { if (st.id !== s.id) return st; const nextPermissions = st.permissions ?? defaultPermissionsForRole(st.role); return { ...st, permissions: { ...nextPermissions, [key]: !nextPermissions[key] } }; }) }); }} className={`flex items-center justify-between rounded-lg border px-2 py-1.5 text-xs ${staffPermissions[key] ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"} ${s.role === "owner" ? "opacity-60 cursor-not-allowed" : "hover:bg-white/5"}`}><span>{label}</span><span className={`w-8 h-4 rounded-full relative ${staffPermissions[key] ? "bg-primary" : "bg-white/10"}`}><span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${staffPermissions[key] ? "left-[18px]" : "left-0.5"}`} /></span></button>))}</div></div>; })}</div>
              <div className="rounded-xl border border-dashed border-border p-4">
                <p className="text-xs text-muted-foreground mb-3 uppercase tracking-widest" style={{ fontFamily: "'DM Mono', monospace" }}>Add User</p>
                <div className="space-y-2">
                  <input value={newStaffName} onChange={(e)=>setNewStaffName(e.target.value)} placeholder="Full name" className="w-full rounded-lg bg-white/5 border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50" />
                  <div className="flex gap-2"><input value={newStaffPin} onChange={(e)=>setNewStaffPin(e.target.value.replace(/\D/g,"").slice(0,4))} placeholder="4-digit PIN" maxLength={4} className="flex-1 rounded-lg bg-white/5 border border-border px-3 py-2 text-sm text-foreground focus:outline-none" style={{ fontFamily: "'DM Mono', monospace" }} /><select value={newStaffRole} onChange={(e)=>setNewStaffRole(e.target.value as StaffMember["role"])} className="rounded-lg bg-[#1a1510] border border-border px-3 py-2 text-sm text-foreground focus:outline-none"><option value="bartender">Bartender</option><option value="manager">Manager</option></select></div>
                  <button onClick={()=>{if(!newStaffName.trim()||newStaffPin.length!==4)return;update({staff:[...tenant.staff,{id:uid(),name:newStaffName.trim(),pin:newStaffPin,role:newStaffRole,permissions:defaultPermissionsForRole(newStaffRole)}]});setNewStaffName("");setNewStaffPin("");setNewStaffRole("bartender");}} disabled={!newStaffName.trim()||newStaffPin.length!==4} className="w-full rounded-lg bg-primary/15 border border-primary/25 text-primary py-2 text-sm font-semibold hover:bg-primary/20 disabled:opacity-30">+ Add Business User</button>
                </div>
              </div>
            </div>
          )}

          {section === "customers" && (
            <div className="max-w-2xl">
              <h2 className="text-xl font-bold mb-5" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>Customers</h2>
              <div className="rounded-xl border border-border bg-card/40 p-4 mb-5">
                <p className="text-xs text-muted-foreground mb-3 uppercase tracking-widest" style={{ fontFamily: "'DM Mono', monospace" }}>{editingCust ? "Edit Customer" : "Add Customer"}</p>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  <input value={newCustName} onChange={(e)=>setNewCustName(e.target.value)} placeholder="Name *" className="rounded-lg bg-white/5 border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50" />
                  <input value={newCustEmail} onChange={(e)=>setNewCustEmail(e.target.value)} placeholder="Email" className="rounded-lg bg-white/5 border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50" />
                  <input value={newCustPhone} onChange={(e)=>setNewCustPhone(e.target.value)} placeholder="Phone" className="rounded-lg bg-white/5 border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50" />
                </div>
                <div className="flex gap-2">
                  <button onClick={()=>{if(!newCustName.trim())return;if(editingCust){update({customers:tenant.customers.map((c)=>c.id===editingCust.id?{...c,name:newCustName.trim(),email:newCustEmail,phone:newCustPhone}:c)});setEditingCust(null);}else{update({customers:[...tenant.customers,{id:uid(),name:newCustName.trim(),email:newCustEmail,phone:newCustPhone,totalSpent:0,visits:0,notes:""}]});}setNewCustName("");setNewCustEmail("");setNewCustPhone("");}} disabled={!newCustName.trim()} className="rounded-lg bg-primary text-primary-foreground px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-30">{editingCust?"Save":"Add"}</button>
                  {editingCust && <button onClick={()=>{setEditingCust(null);setNewCustName("");setNewCustEmail("");setNewCustPhone("");}} className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</button>}
                </div>
              </div>
              {tenant.customers.length === 0 ? <div className="text-center py-12 text-muted-foreground"><UserCheck size={32} className="mx-auto mb-2 opacity-20" /><p className="text-sm">No customers yet.</p></div> : (
                <div className="space-y-1.5">{tenant.customers.map((c) => <div key={c.id} className="flex items-center gap-3 rounded-xl border border-border bg-card/30 px-4 py-3"><div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0"><span className="text-primary text-sm font-bold">{c.name[0]}</span></div><div className="flex-1 min-w-0"><p className="text-sm font-semibold">{c.name}</p><p className="text-xs text-muted-foreground truncate">{c.email}{c.phone&&` · ${c.phone}`}</p></div><div className="text-right shrink-0"><p className="text-xs font-semibold" style={{ fontFamily: "'DM Mono', monospace" }}>R{c.totalSpent.toFixed(0)}</p><p className="text-[10px] text-muted-foreground">{c.visits} visits</p></div><button onClick={()=>{setEditingCust(c);setNewCustName(c.name);setNewCustEmail(c.email);setNewCustPhone(c.phone);}} className="p-1.5 text-muted-foreground hover:text-primary"><Edit2 size={13} /></button><button onClick={()=>update({customers:tenant.customers.filter((cu)=>cu.id!==c.id)})} className="p-1.5 text-muted-foreground hover:text-red-400"><Trash2 size={13} /></button></div>)}</div>
              )}
            </div>
          )}

          {section === "sales" && <SalesSection sales={tenant.sales} />}

          {section === "system" && (
            <div className="max-w-xl">
              <h2 className="text-xl font-bold mb-5" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>System</h2>
              <div className="rounded-xl border border-border bg-card/30 p-5 mb-4">
                <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3" style={{ fontFamily: "'DM Mono', monospace" }}>Hardware Settings</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2"><Printer size={13} className="text-primary" /><p className="text-sm font-semibold">Printers</p></div>
                    <div className="space-y-1.5 mb-3">
                      {printers.length === 0 && <p className="text-xs text-muted-foreground">No printers assigned yet.</p>}
                      {printers.map((p) => (
                        <div key={p.id} className="rounded-lg border border-border bg-white/3 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold truncate">{p.name}</p>
                              <p className="text-[10px] text-muted-foreground truncate" style={{ fontFamily: "'DM Mono', monospace" }}>{p.connection.toUpperCase()} {p.target ? `• ${p.target}` : ""}</p>
                            </div>
                            <button onClick={() => updateConfig({ printers: printers.filter((d) => d.id !== p.id), defaultPrinterId: config.defaultPrinterId === p.id ? undefined : config.defaultPrinterId })} className="p-1 text-muted-foreground hover:text-red-400"><Trash2 size={12} /></button>
                          </div>
                          <div className="flex items-center justify-between mt-2">
                            <button onClick={() => updateConfig({ defaultPrinterId: p.id })} className={`text-[10px] px-2 py-0.5 rounded border ${config.defaultPrinterId === p.id ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>Default</button>
                            <button onClick={() => updateConfig({ printers: printers.map((d) => d.id === p.id ? { ...d, enabled: !d.enabled } : d), defaultPrinterId: p.enabled && config.defaultPrinterId === p.id ? undefined : config.defaultPrinterId })} className={`w-10 h-5 rounded-full relative ${p.enabled ? "bg-primary" : "bg-white/10"}`}><span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${p.enabled ? "left-[20px]" : "left-0.5"}`} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-1.5">
                      <input value={newPrinterName} onChange={(e) => setNewPrinterName(e.target.value)} placeholder="Printer name" className="w-full rounded-lg bg-white/5 border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50" />
                      <div className="flex gap-2">
                        <select value={newPrinterConnection} onChange={(e) => setNewPrinterConnection(e.target.value as HardwareDevice["connection"])} className="rounded-lg bg-[#1a1510] border border-border px-2 py-2 text-xs text-foreground focus:outline-none">
                          <option value="usb">USB</option><option value="network">Network</option><option value="bluetooth">Bluetooth</option>
                        </select>
                        <input value={newPrinterTarget} onChange={(e) => setNewPrinterTarget(e.target.value)} placeholder="IP / Port / Device" className="flex-1 rounded-lg bg-white/5 border border-border px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary/50" />
                      </div>
                      <button onClick={() => { if (!newPrinterName.trim()) return; const n: HardwareDevice = { id: uid(), name: newPrinterName.trim(), connection: newPrinterConnection, target: newPrinterTarget.trim(), enabled: true }; updateConfig({ printers: [...printers, n], defaultPrinterId: config.defaultPrinterId ?? n.id }); setNewPrinterName(""); setNewPrinterTarget(""); setNewPrinterConnection("usb"); }} className="w-full rounded-lg bg-primary/15 border border-primary/25 text-primary py-2 text-xs font-semibold hover:bg-primary/20">+ Add Printer</button>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-2"><QrCode size={13} className="text-primary" /><p className="text-sm font-semibold">Scanners</p></div>
                    <div className="space-y-1.5 mb-3">
                      {scanners.length === 0 && <p className="text-xs text-muted-foreground">No scanners assigned yet.</p>}
                      {scanners.map((s) => (
                        <div key={s.id} className="rounded-lg border border-border bg-white/3 px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold truncate">{s.name}</p>
                              <p className="text-[10px] text-muted-foreground truncate" style={{ fontFamily: "'DM Mono', monospace" }}>{s.connection.toUpperCase()} {s.target ? `• ${s.target}` : ""}</p>
                            </div>
                            <button onClick={() => updateConfig({ scanners: scanners.filter((d) => d.id !== s.id), defaultScannerId: config.defaultScannerId === s.id ? undefined : config.defaultScannerId })} className="p-1 text-muted-foreground hover:text-red-400"><Trash2 size={12} /></button>
                          </div>
                          <div className="flex items-center justify-between mt-2">
                            <button onClick={() => updateConfig({ defaultScannerId: s.id })} className={`text-[10px] px-2 py-0.5 rounded border ${config.defaultScannerId === s.id ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>Default</button>
                            <button onClick={() => updateConfig({ scanners: scanners.map((d) => d.id === s.id ? { ...d, enabled: !d.enabled } : d), defaultScannerId: s.enabled && config.defaultScannerId === s.id ? undefined : config.defaultScannerId })} className={`w-10 h-5 rounded-full relative ${s.enabled ? "bg-primary" : "bg-white/10"}`}><span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${s.enabled ? "left-[20px]" : "left-0.5"}`} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-1.5">
                      <input value={newScannerName} onChange={(e) => setNewScannerName(e.target.value)} placeholder="Scanner name" className="w-full rounded-lg bg-white/5 border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50" />
                      <div className="flex gap-2">
                        <select value={newScannerConnection} onChange={(e) => setNewScannerConnection(e.target.value as HardwareDevice["connection"])} className="rounded-lg bg-[#1a1510] border border-border px-2 py-2 text-xs text-foreground focus:outline-none">
                          <option value="usb">USB</option><option value="network">Network</option><option value="bluetooth">Bluetooth</option>
                        </select>
                        <input value={newScannerTarget} onChange={(e) => setNewScannerTarget(e.target.value)} placeholder="IP / Port / Device" className="flex-1 rounded-lg bg-white/5 border border-border px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary/50" />
                      </div>
                      <button onClick={() => { if (!newScannerName.trim()) return; const n: HardwareDevice = { id: uid(), name: newScannerName.trim(), connection: newScannerConnection, target: newScannerTarget.trim(), enabled: true }; updateConfig({ scanners: [...scanners, n], defaultScannerId: config.defaultScannerId ?? n.id }); setNewScannerName(""); setNewScannerTarget(""); setNewScannerConnection("usb"); }} className="w-full rounded-lg bg-primary/15 border border-primary/25 text-primary py-2 text-xs font-semibold hover:bg-primary/20">+ Add Scanner</button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-card/30 p-5 mb-4">
                <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3" style={{ fontFamily: "'DM Mono', monospace" }}>Management</p>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>Subscriptions and automated plans have been removed.</p>
                  <p>Billing is handled manually by superadmin outside the app.</p>
                  <p>Business users are created and managed from the company admin panel.</p>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-card/30 p-5 mb-4">
                <p className="text-xs text-muted-foreground uppercase tracking-widest mb-3" style={{ fontFamily: "'DM Mono', monospace" }}>Account</p>
                <div className="space-y-1.5 text-sm">{[["Email",tenant.email],["Member Since",fmtDate(tenant.createdAt)],["Tenant ID",tenant.id]].map(([l,v])=><div key={l} className="flex justify-between"><span className="text-muted-foreground">{l}</span><span style={{ fontFamily: "'DM Mono', monospace" }} className="text-foreground truncate max-w-[60%] text-right">{v}</span></div>)}</div>
              </div>
              <div className="rounded-xl border border-border bg-card/30 p-5">
                <div className="flex items-center gap-2 mb-3"><Bell size={13} className="text-primary" /><p className="text-xs text-muted-foreground uppercase tracking-widest" style={{ fontFamily: "'DM Mono', monospace" }}>Changelog</p></div>
                <div className="space-y-4">{CHANGELOG.map((r) => <div key={r.version}><div className="flex items-center justify-between mb-1.5"><span className="text-sm font-bold text-primary" style={{ fontFamily: "'DM Mono', monospace" }}>v{r.version}</span><span className="text-[10px] text-muted-foreground">{r.date}</span></div><ul className="space-y-0.5">{r.notes.map((n)=><li key={n} className="flex items-center gap-1.5 text-xs text-muted-foreground"><CheckCircle size={10} className="text-primary shrink-0" />{n}</li>)}</ul></div>)}</div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT DISPLAY
// ─────────────────────────────────────────────────────────────────────────────

function ClientDisplay({ activeTab, tenant, onBack }: { activeTab: Tab | null; tenant: Tenant; onBack: () => void; }) {
  const zarCur = tenant.config.currencies.find((c) => c.code === "ZAR")!;
  const sub = activeTab ? calcSubtotal(activeTab.orders) : 0;
  const tax = calcTax(sub, tenant.config);
  const total = sub + tax;
  const prepaid = activeTab?.prepaid ?? 0;
  const balance = prepaid - total;
  const [now, setNow] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(id); }, []);

  return (
    <div className="h-screen w-screen bg-background flex flex-col items-center justify-center relative overflow-hidden" style={{ fontFamily: "'Barlow', sans-serif" }}>
      <button onClick={onBack} className="absolute top-4 left-4 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"><ArrowLeft size={14} /> Back to POS</button>
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: "radial-gradient(circle at 2px 2px, #c8823a 1px, transparent 0)", backgroundSize: "40px 40px" }} />
      <div className="text-center mb-10">
        <TenantBrandMark businessInfo={tenant.businessInfo} size="lg" className="mx-auto mb-3" />
        <h1 className="text-4xl font-black tracking-wider" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>{tenant.businessInfo.name.toUpperCase()}</h1>
        <p className="text-muted-foreground text-sm mt-1" style={{ fontFamily: "'DM Mono', monospace" }}>{fmtTime(now)}</p>
      </div>
      {activeTab ? (
        <div className="w-full max-w-md px-6">
          <div className="rounded-2xl border border-amber-900/25 bg-card/60 backdrop-blur-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex justify-between items-center">
              <div><p className="text-xs text-muted-foreground tracking-widest uppercase" style={{ fontFamily: "'DM Mono', monospace" }}>Order</p><p className="text-xl font-bold" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>{activeTab.name}</p></div>
              {prepaid > 0 && <div className="text-right"><p className="text-[10px] text-muted-foreground uppercase tracking-widest" style={{ fontFamily: "'DM Mono', monospace" }}>Prepaid</p><p className="text-lg font-bold text-green-400" style={{ fontFamily: "'DM Mono', monospace" }}>{zarCur.symbol}{prepaid.toFixed(2)}</p></div>}
            </div>
            <div className="px-6 py-3 max-h-56 overflow-y-auto space-y-2">
              {activeTab.orders.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">Your order will appear here…</p> : activeTab.orders.map((o) => <div key={o.menuItem.id} className="flex justify-between"><p className="text-sm font-medium">{o.qty}× {o.menuItem.name}</p><span style={{ fontFamily: "'DM Mono', monospace" }}>{fmt(o.menuItem.price * o.qty, zarCur)}</span></div>)}
            </div>
            {activeTab.orders.length > 0 && (
              <div className="px-6 py-4 border-t border-border space-y-1 bg-white/2">
                <div className="flex justify-between text-sm text-muted-foreground"><span>Subtotal</span><span style={{ fontFamily: "'DM Mono', monospace" }}>{fmt(sub, zarCur)}</span></div>
                {tax > 0 && <div className="flex justify-between text-sm text-muted-foreground"><span>VAT</span><span style={{ fontFamily: "'DM Mono', monospace" }}>{fmt(tax, zarCur)}</span></div>}
                <div className="flex justify-between text-lg font-bold text-primary"><span>TOTAL</span><span style={{ fontFamily: "'DM Mono', monospace" }}>{fmt(total, zarCur)}</span></div>
                {prepaid > 0 && <div className={`flex justify-between text-sm font-bold ${balance >= 0 ? "text-green-400" : "text-red-400"}`}><span>{balance >= 0 ? "Change Due" : "Balance Owed"}</span><span style={{ fontFamily: "'DM Mono', monospace" }}>{zarCur.symbol}{Math.abs(balance).toFixed(2)}</span></div>}
              </div>
            )}
          </div>
        </div>
      ) : <p className="text-muted-foreground text-lg">Welcome! Your bartender will be right with you.</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// POS VIEW
// ─────────────────────────────────────────────────────────────────────────────

let _tabSeq = 10;

function POSView({ tenant, staffId, onTenantChange, onSalePersisted, onAdmin, onClient, onLogout }: { tenant: Tenant; staffId: string; onTenantChange: (t: Tenant) => void; onSalePersisted: (sale: SaleRecord, updated: Tenant) => void; onAdmin: () => void; onClient: () => void; onLogout: () => void; }) {
  const [tabs, setTabs] = useState<Tab[]>(() => hydrateTabs(tenant.config.posState?.tabs));
  const [activeTabId, setActiveTabId] = useState<string | null>(() => tenant.config.posState?.activeTabId ?? null);
  const [activeCategory, setActiveCategory] = useState("All");
  const [payingTab, setPayingTab] = useState<Tab | null>(null);
  const [showNewTab, setShowNewTab] = useState(false);
  const [pendingSale, setPendingSale] = useState<SaleRecord | null>(null);
  const [now, setNow] = useState(new Date());
  const tenantRef = useRef(tenant);
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id); }, []);

  useEffect(() => {
    tenantRef.current = tenant;
  }, [tenant]);

  useEffect(() => {
    const restoredTabs = hydrateTabs(tenant.config.posState?.tabs);
    const restoredActive = tenant.config.posState?.activeTabId ?? null;
    setTabs(restoredTabs);
    setActiveTabId(restoredActive && restoredTabs.some((tab) => tab.id === restoredActive) ? restoredActive : restoredTabs[0]?.id ?? null);
  }, [tenant.id]);

  useEffect(() => {
    const maxTabSeq = tabs.reduce((max, tab) => {
      const match = /^t(\d+)$/.exec(tab.id);
      const seq = match ? Number(match[1]) : 0;
      return Math.max(max, seq);
    }, 0);
    if (maxTabSeq > _tabSeq) _tabSeq = maxTabSeq;
  }, [tabs]);

  useEffect(() => {
    const normalizedActiveTabId = activeTabId && tabs.some((tab) => tab.id === activeTabId) ? activeTabId : null;
    const nextPosState: PersistedPosState = { tabs: serializeTabs(tabs), activeTabId: normalizedActiveTabId };
    const currentPosState = tenantRef.current.config.posState ?? { tabs: [], activeTabId: null };

    if (JSON.stringify(currentPosState) === JSON.stringify(nextPosState)) return;

    onTenantChange({
      ...tenantRef.current,
      config: {
        ...tenantRef.current.config,
        posState: nextPosState,
      },
    });
  }, [tabs, activeTabId, onTenantChange]);

  const { config, menu } = tenant;
  const staff = tenant.staff.find((s) => s.id === staffId);
  const permissions = staff?.permissions ?? defaultPermissionsForRole(staff?.role ?? "bartender");
  const zarSymbol = config.currencies.find((c) => c.code === "ZAR")?.symbol ?? "R";
  const enabledCats = ["All", ...config.categories.filter((c) => c.enabled).map((c) => c.name)];
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  useEffect(() => { if (!enabledCats.includes(activeCategory)) setActiveCategory("All"); }, [config.categories]);

  const filtered = activeCategory === "All" ? menu.filter((m) => enabledCats.includes(m.category)) : menu.filter((m) => m.category === activeCategory);

  function addToOrder(item: MenuItem) {
    if (!permissions.editOrders || !activeTabId || item.stock === 0) return;
    setTabs((prev) => prev.map((tab) => {
      if (tab.id !== activeTabId) return tab;
      const existing = tab.orders.find((o) => o.menuItem.id === item.id);
      if (item.stock !== -1 && (existing?.qty ?? 0) >= item.stock) return tab;
      if (existing) return { ...tab, orders: tab.orders.map((o) => o.menuItem.id === item.id ? { ...o, qty: o.qty + 1 } : o) };
      return { ...tab, orders: [...tab.orders, { menuItem: item, qty: 1 }] };
    }));
  }

  function changeQty(tabId: string, itemId: string, delta: number) {
    if (!permissions.editOrders) return;
    setTabs((prev) => prev.map((tab) => { if (tab.id !== tabId) return tab; return { ...tab, orders: tab.orders.map((o) => o.menuItem.id === itemId ? { ...o, qty: o.qty + delta } : o).filter((o) => o.qty > 0) }; }));
  }

  function createTab(name: string, prepaid?: number, customerId?: string) {
    if (!permissions.openTabs) return;
    _tabSeq++;
    const t: Tab = { id: `t${_tabSeq}`, name, orders: [], opened: new Date(), prepaid, customerId };
    setTabs((p) => [...p, t]); setActiveTabId(t.id); setShowNewTab(false);
  }

  function closeTabById(id: string) {
    if (!permissions.openTabs) return;
    setTabs((p) => p.filter((t) => t.id !== id));
    if (activeTabId === id) setActiveTabId(null);
  }

  function handlePaymentComplete(sale: SaleRecord) {
    let updated = { ...tenant, sales: [sale, ...tenant.sales] };
    if (sale.customerId) updated.customers = tenant.customers.map((c) => c.id === sale.customerId ? { ...c, totalSpent: c.totalSpent + sale.total, visits: c.visits + 1 } : c);
    onSalePersisted(sale, updated);
    if (payingTab) closeTabById(payingTab.id);
    setPayingTab(null);
    setPendingSale(sale);
  }

  const subtotal = activeTab ? calcSubtotal(activeTab.orders) : 0;
  const tax = calcTax(subtotal, config);
  const total = subtotal + tax;
  const prepaid = activeTab?.prepaid ?? 0;
  const balance = prepaid > 0 ? prepaid - total : 0;

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-background text-foreground select-none" style={{ fontFamily: "'Barlow', sans-serif" }}>
      <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-card/60 backdrop-blur-sm z-10 shrink-0">
        <div className="flex items-center gap-2.5">
          <TenantBrandMark businessInfo={tenant.businessInfo} size="sm" />
          <span className="text-base font-black tracking-wider hidden sm:block" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>{tenant.businessInfo.name.toUpperCase()}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-1 text-xs text-muted-foreground border border-border rounded-lg px-3 py-1.5"><Users size={12} /> {tabs.length}</div>
          <div className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground border border-border rounded-lg px-3 py-1.5" style={{ fontFamily: "'DM Mono', monospace" }}><Clock size={12} /> {fmtTime(now)}</div>
          {staff && <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground border border-border rounded-lg px-3 py-1.5"><User size={12} /> {staff.name.split(" ")[0]}</div>}
          <button onClick={onClient} disabled={!permissions.useClientDisplay} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"><Monitor size={12} /></button>
          <button onClick={onAdmin} disabled={!permissions.adminAccess} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"><Settings size={12} /></button>
          <button onClick={onLogout} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-red-400 hover:border-red-900/30 transition-colors"><LogOut size={12} /></button>
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        {/* Tabs sidebar */}
        <aside className="w-48 shrink-0 border-r border-border bg-card/30 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 pt-4 pb-2"><span className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase" style={{ fontFamily: "'DM Mono', monospace" }}>Open Tabs</span><button onClick={()=>setShowNewTab(true)} disabled={!permissions.openTabs} className="rounded-md w-6 h-6 flex items-center justify-center bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"><Plus size={13} /></button></div>
          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
            {tabs.map((tab) => { const isActive = tab.id === activeTabId; const s = calcSubtotal(tab.orders); const t = s + calcTax(s, config); const pp = tab.prepaid ?? 0; return (
              <button key={tab.id} onClick={()=>setActiveTabId(tab.id)} className={`w-full text-left rounded-lg px-3 py-2.5 transition-all ${isActive?"bg-primary/15 border border-primary/25":"border border-transparent hover:bg-white/5"}`}>
                <div className="flex items-start justify-between"><span className={`text-sm font-semibold truncate ${isActive?"text-primary":"text-foreground"}`}>{tab.name}</span>{pp>0&&<span className="text-[9px] text-green-400 font-bold ml-1 shrink-0">PP</span>}</div>
                <div className="flex justify-between mt-0.5"><span className="text-[10px] text-muted-foreground" style={{ fontFamily: "'DM Mono', monospace" }}>{elapsed(tab.opened)}</span><span className="text-[11px] text-muted-foreground" style={{ fontFamily: "'DM Mono', monospace" }}>{zarSymbol}{t.toFixed(0)}</span></div>
              </button>
            ); })}
            {tabs.length === 0 && <p className="text-xs text-muted-foreground text-center py-8 px-2">No open tabs.</p>}
          </div>
          <div className="px-2 pb-3"><button onClick={()=>setShowNewTab(true)} disabled={!permissions.openTabs} className="w-full rounded-lg border border-dashed border-primary/25 py-2.5 text-xs text-primary/70 hover:border-primary/40 hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed">+ New Tab</button></div>
        </aside>

        {/* Menu */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center gap-1 px-4 pt-3 pb-2.5 border-b border-border shrink-0 overflow-x-auto">
            {enabledCats.map((cat) => <button key={cat} onClick={()=>setActiveCategory(cat)} className={`shrink-0 rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all ${activeCategory===cat?"bg-primary text-primary-foreground":"text-muted-foreground hover:text-foreground hover:bg-white/5"}`} style={{ fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.04em" }}>{cat.toUpperCase()}</button>)}
          </div>
          {!activeTabId && <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg bg-primary/8 border border-primary/20 px-4 py-2 text-xs text-primary/80"><AlertCircle size={13} /> Select or open a tab to start ordering</div>}
          <div className="flex-1 overflow-y-auto px-4 pt-3 pb-4">
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
              {filtered.map((item) => {
                const oos = item.stock === 0;
                const oqty = activeTab?.orders.find((o) => o.menuItem.id === item.id)?.qty ?? 0;
                const atLim = item.stock !== -1 && oqty >= item.stock && item.stock > 0;
                const dis = !activeTabId || oos || !permissions.editOrders;
                return (
                  <button key={item.id} onClick={()=>!dis&&!atLim&&addToOrder(item)} disabled={dis||atLim}
                    className={`group relative text-left rounded-xl border p-3.5 transition-all active:scale-[0.97] ${oos?"border-red-900/30 bg-red-900/5 opacity-50 cursor-not-allowed":dis||atLim?"border-border/50 bg-card/40 opacity-50 cursor-not-allowed":"border-border bg-card hover:border-primary/30 hover:bg-primary/5 cursor-pointer"}`}>
                    {item.popular&&!oos&&<span className="absolute top-2.5 right-2.5 text-[9px] font-bold text-primary/80 uppercase" style={{ fontFamily: "'DM Mono', monospace" }}>HOT</span>}
                    {oos&&<span className="absolute top-2.5 right-2.5 text-[9px] font-bold text-red-400/80 uppercase" style={{ fontFamily: "'DM Mono', monospace" }}>OUT</span>}
                    {oqty>0&&!oos&&<span className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">{oqty}</span>}
                    <p className="text-sm font-semibold text-foreground pr-6 leading-tight" style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: "0.92rem" }}>{item.name}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{item.description}</p>
                    <div className="flex items-end justify-between mt-2">
                      <p className="text-sm font-bold text-primary" style={{ fontFamily: "'DM Mono', monospace" }}>{zarSymbol}{item.price.toFixed(2)}</p>
                      {item.stock!==-1&&item.stock>0&&<p className="text-[10px] text-muted-foreground" style={{ fontFamily: "'DM Mono', monospace" }}>{item.stock} left</p>}
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && <div className="col-span-4 text-center py-16 text-muted-foreground"><Package size={28} className="mx-auto mb-2 opacity-20" /><p className="text-sm">No products in this category.</p></div>}
            </div>
          </div>
        </main>

        {/* Order panel */}
        <aside className="w-64 shrink-0 border-l border-border bg-card/50 flex flex-col overflow-hidden">
          {activeTab ? (
            <>
              <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border shrink-0">
                <div><p className="text-[10px] text-muted-foreground tracking-widest uppercase mb-0.5" style={{ fontFamily: "'DM Mono', monospace" }}>{activeTab.prepaid?"Pre-Paid Tab":"Active Tab"}</p><h2 className="text-lg font-bold leading-none" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>{activeTab.name}</h2></div>
                <button onClick={()=>{if(window.confirm(`Close tab for ${activeTab.name}?`))closeTabById(activeTab.id);}} disabled={!permissions.openTabs} className="p-1.5 text-muted-foreground hover:text-red-400 hover:bg-red-400/10 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed"><Trash2 size={14} /></button>
              </div>
              {activeTab.prepaid && activeTab.prepaid > 0 && (
                <div className={`mx-3 mt-2 rounded-lg px-3 py-2 text-xs flex items-center justify-between ${balance>=0?"bg-green-400/10 border border-green-400/20":"bg-red-400/10 border border-red-400/20"}`}>
                  <span className="text-muted-foreground">Prepaid {zarSymbol}{activeTab.prepaid.toFixed(2)}</span>
                  <span className={`font-bold ${balance>=0?"text-green-400":"text-red-400"}`} style={{ fontFamily: "'DM Mono', monospace" }}>{balance>=0?`${zarSymbol}${balance.toFixed(2)} bal`:`${zarSymbol}${Math.abs(balance).toFixed(2)} owed`}</span>
                </div>
              )}
              <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
                {activeTab.orders.length === 0 ? <div className="text-center py-10"><ShoppingBag size={26} className="text-muted-foreground/25 mx-auto mb-2" /><p className="text-xs text-muted-foreground">No items yet.</p></div> :
                  activeTab.orders.map((o) => (
                    <div key={o.menuItem.id} className="flex items-center gap-2 rounded-lg bg-white/3 border border-white/5 px-3 py-2">
                      <div className="flex-1 min-w-0"><p className="text-xs font-medium truncate">{o.menuItem.name}</p><p className="text-[10px] text-muted-foreground" style={{ fontFamily: "'DM Mono', monospace" }}>{zarSymbol}{o.menuItem.price.toFixed(2)} ea</p></div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={()=>changeQty(activeTab.id,o.menuItem.id,-1)} disabled={!permissions.editOrders} className="w-5 h-5 rounded bg-white/5 hover:bg-white/15 text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed"><Minus size={9} /></button>
                        <span className="text-xs font-bold w-4 text-center" style={{ fontFamily: "'DM Mono', monospace" }}>{o.qty}</span>
                        <button onClick={()=>changeQty(activeTab.id,o.menuItem.id,1)} disabled={!permissions.editOrders} className="w-5 h-5 rounded bg-white/5 hover:bg-white/15 text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed"><Plus size={9} /></button>
                      </div>
                      <span className="text-xs font-semibold w-12 text-right shrink-0" style={{ fontFamily: "'DM Mono', monospace" }}>{zarSymbol}{(o.menuItem.price*o.qty).toFixed(0)}</span>
                    </div>
                  ))}
              </div>
              {activeTab.orders.length > 0 && (
                <div className="px-3 py-2 border-t border-border space-y-0.5 shrink-0">
                  <div className="flex justify-between text-xs text-muted-foreground px-1"><span>Subtotal</span><span style={{ fontFamily: "'DM Mono', monospace" }}>{zarSymbol}{subtotal.toFixed(2)}</span></div>
                  {config.vatEnabled && <div className="flex justify-between text-xs text-muted-foreground px-1"><span>VAT ({config.vatRate}%)</span><span style={{ fontFamily: "'DM Mono', monospace" }}>{zarSymbol}{tax.toFixed(2)}</span></div>}
                  <div className="flex justify-between text-sm font-bold px-1 pt-1 border-t border-border"><span>Total</span><span className="text-primary" style={{ fontFamily: "'DM Mono', monospace" }}>{zarSymbol}{total.toFixed(2)}</span></div>
                </div>
              )}
              <div className="px-3 pb-4 pt-2 shrink-0">
                <button onClick={()=>setPayingTab(activeTab)} disabled={activeTab.orders.length===0 || !permissions.chargeTabs} className="w-full rounded-xl bg-primary text-primary-foreground py-3.5 text-sm font-bold tracking-widest transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}><CreditCard size={15} /> CHARGE TAB</button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-5 gap-3"><Receipt size={32} className="text-muted-foreground/20" /><p className="text-xs text-muted-foreground">Select or open a tab.</p><button onClick={()=>setShowNewTab(true)} disabled={!permissions.openTabs} className="rounded-lg bg-primary/15 border border-primary/25 text-primary text-xs font-semibold px-4 py-2 hover:bg-primary/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">+ Open New Tab</button></div>
          )}
        </aside>
      </div>

      {payingTab && <PaymentModal tab={payingTab} tenant={tenant} staffId={staffId} onClose={()=>setPayingTab(null)} onComplete={handlePaymentComplete} />}
      {showNewTab && <NewTabModal tenant={tenant} onClose={()=>setShowNewTab(false)} onCreate={createTab} />}
      {pendingSale && <ReceiptModal sale={pendingSale} businessInfo={tenant.businessInfo} onClose={()=>setPendingSale(null)} />}
    </div>
  );
}

function BackendGate({
  status,
  message,
  onRetry,
}: {
  status: "checking" | "ready" | "down";
  message: string;
  onRetry: () => void;
}) {
  if (status === "ready") return null;

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4" style={{ fontFamily: "'Barlow', sans-serif" }}>
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card/40 p-7">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center">
            <AlertCircle size={16} className={status === "checking" ? "text-primary" : "text-red-400"} />
          </div>
          <h2 className="text-xl font-bold" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            {status === "checking" ? "Checking Backend" : "Backend Not Reachable"}
          </h2>
        </div>

        {status === "checking" ? (
          <p className="text-sm text-muted-foreground">Validating Supabase/API connectivity before loading the app...</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-3">{message}</p>
            <p className="text-xs text-muted-foreground/80 mb-5">API base: {API_BASE}</p>
            <button
              onClick={onRetry}
              className="rounded-xl bg-primary text-primary-foreground px-5 py-2.5 text-sm font-bold hover:opacity-90 transition-opacity"
              style={{ fontFamily: "'Barlow Condensed', sans-serif" }}
            >
              Retry Connection
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [backendStatus, setBackendStatus] = useState<"checking" | "ready" | "down">("checking");
  const [backendMessage, setBackendMessage] = useState("Connecting to Supabase API...");
  const [screen, setScreen] = useState<AppScreen>("landing");
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [tenantToken, setTenantToken] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [staffConfirmed, setStaffConfirmed] = useState(false);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistTenantSnapshot = useCallback((snapshot: Tenant) => {
    if (!tenantToken) return;
    apiSaveTenant(snapshot.email, {
      businessInfo: snapshot.businessInfo,
      config: snapshot.config,
      menu: snapshot.menu,
      staff: snapshot.staff,
      customers: snapshot.customers,
    }, tenantToken).catch(console.error);
  }, [tenantToken]);

  const verifyBackend = useCallback(async () => {
    setBackendStatus("checking");
    setBackendMessage("Connecting to Supabase API...");
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ email: "healthcheck@invalid.local", password: "invalid" }),
      });

      const reachableStatus = res.ok || [400, 401, 403, 422].includes(res.status);
      if (!reachableStatus) {
        setBackendStatus("down");
        if (res.status === 404) {
          setBackendMessage("Supabase edge function was not found (404). Deploy the 'server' function and confirm VITE_API_BASE points to /functions/v1/server.");
        } else {
          setBackendMessage(`Supabase API returned unexpected status (${res.status}). Verify function deployment and environment settings.`);
        }
        return;
      }

      setBackendStatus("ready");
      setBackendMessage("");
    } catch {
      setBackendStatus("down");
      setBackendMessage("Supabase API is unavailable or blocked by CORS. Please verify your function deployment and environment settings.");
    }
  }, []);

  useEffect(() => {
    verifyBackend();
  }, [verifyBackend]);

  function handleVenueLogin(t: Tenant, token?: string) {
    setTenant(t);
    setTenantToken(token ?? t.tenantToken ?? null);
    const owner = t.staff.find((s) => s.role === "owner") ?? t.staff[0];
    setSession({ tenantId: t.id, staffId: owner?.id ?? "" });
    setStaffConfirmed(false);
    setScreen("pos");
  }

  function handleVenueLogout() {
    if (tenant) {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      persistTenantSnapshot(tenant);
    }
    setTenant(null);
    setTenantToken(null);
    setSession(null);
    setStaffConfirmed(false);
    setScreen("landing");
  }

  function handleAdminLogin(token: string) {
    setAdminToken(token);
    setScreen("superadmin");
  }

  function handleAdminLogout() {
    setAdminToken(null);
    setScreen("landing");
  }

  // Debounced save — tenant data changes
  function updateTenant(updated: Tenant) {
    setTenant(updated);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      persistTenantSnapshot(updated);
    }, 1500);
  }

  // Immediate sale persist + customer update
  function handleSalePersisted(sale: SaleRecord, updatedTenant: Tenant) {
    setTenant(updatedTenant);
    if (!tenantToken) return;
    apiAddSale(updatedTenant.email, { ...sale, timestamp: sale.timestamp.toISOString() }, tenantToken).catch(console.error);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      apiSaveTenant(updatedTenant.email, { customers: updatedTenant.customers }, tenantToken).catch(console.error);
    }, 500);
  }

  if (backendStatus !== "ready") {
    return <BackendGate status={backendStatus} message={backendMessage} onRetry={verifyBackend} />;
  }

  // ── Screen routing ───────────────────────────────────────────────────────
  if (screen === "landing") {
    return <LandingPage onVenueLogin={() => setScreen("venue_login")} onSuperAdmin={() => setScreen("superadmin_login")} />;
  }

  if (screen === "superadmin_login") {
    return <SuperAdminLogin onSuccess={handleAdminLogin} onBack={() => setScreen("landing")} />;
  }

  if (screen === "superadmin") {
    if (!adminToken) return <SuperAdminLogin onSuccess={handleAdminLogin} onBack={() => setScreen("landing")} />;
    return <SuperAdminDashboard token={adminToken} onBack={handleAdminLogout} />;
  }

  if (screen === "venue_login") {
    return <VenueLogin onLogin={handleVenueLogin} onBack={() => setScreen("landing")} />;
  }

  if (!tenant || !session) {
    return <LandingPage onVenueLogin={() => setScreen("venue_login")} onSuperAdmin={() => setScreen("superadmin_login")} />;
  }

  const activeStaff = tenant.staff.find((s) => s.id === session.staffId) ?? null;
  const activePermissions = activeStaff?.permissions ?? defaultPermissionsForRole(activeStaff?.role ?? "bartender");

  if (!staffConfirmed) {
    return <StaffSelector tenant={tenant} onSelect={(staffId) => { setSession({ ...session, staffId }); setStaffConfirmed(true); }} onBack={handleVenueLogout} />;
  }

  if (screen === "admin") {
    if (!activePermissions.adminAccess) return <POSView tenant={tenant} staffId={session.staffId} onTenantChange={updateTenant} onSalePersisted={handleSalePersisted} onAdmin={() => undefined} onClient={() => setScreen("client")} onLogout={handleVenueLogout} />;
    return <AdminPanel tenant={tenant} currentStaffId={session.staffId} onTenantChange={updateTenant} onBack={() => setScreen("pos")} />;
  }
  if (screen === "client") return <ClientDisplay activeTab={null} tenant={tenant} onBack={() => setScreen("pos")} />;

  return (
    <POSView
      tenant={tenant}
      staffId={session.staffId}
      onTenantChange={updateTenant}
      onSalePersisted={handleSalePersisted}
      onAdmin={() => { if (activePermissions.adminAccess) setScreen("admin"); }}
      onClient={() => setScreen("client")}
      onLogout={handleVenueLogout}
    />
  );
}
