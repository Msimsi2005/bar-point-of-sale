import { readFileSync, writeFileSync } from 'fs';

const file = 'src/app/App.tsx';
let content = readFileSync(file, 'utf8');

// 1. Add printer discovery helpers after fillReceiptPlaceholders function
const printerHelpers = `
interface DiscoveredPrinterInfo { name?: string; displayName?: string; description?: string; uri?: string; address?: string; }

async function discoverPrinters(): Promise<HardwareDevice[]> {
  const found: HardwareDevice[] = [];
  const seen = new Set<string>();
  try {
    const navAny = navigator as unknown as {
      printers?: Iterable<DiscoveredPrinterInfo> | { values?: () => Iterable<DiscoveredPrinterInfo> } | ArrayLike<DiscoveredPrinterInfo>;
    };
    if (navAny.printers) {
      const printersSource = navAny.printers as
        | Iterable<DiscoveredPrinterInfo>
        | { values?: () => Iterable<DiscoveredPrinterInfo> }
        | ArrayLike<DiscoveredPrinterInfo>;
      let list: DiscoveredPrinterInfo[] = [];
      if (Array.isArray(printersSource)) list = [...printersSource];
      else if (typeof (printersSource as { values?: () => Iterable<DiscoveredPrinterInfo> }).values === "function")
        list = [...(printersSource as { values: () => Iterable<DiscoveredPrinterInfo> }).values()];
      else if (Symbol.iterator in Object(printersSource)) list = [...(printersSource as Iterable<DiscoveredPrinterInfo>)];
      for (const p of list) {
        const name = String(p.displayName || p.name || "Printer");
        const uri = String(p.uri || p.address || "");
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        found.push({ id: uid(), name, connection: "network", target: uri || name, enabled: true });
      }
    }
  } catch {
    // Web Printing API not available
  }
  return found;
}

function trySilentPrint(html: string, onFallback?: () => void) {
  try {
    const hiddenFrame = document.createElement("iframe");
    hiddenFrame.style.position = "absolute";
    hiddenFrame.style.width = "0px";
    hiddenFrame.style.height = "0px";
    hiddenFrame.style.border = "0";
    hiddenFrame.style.left = "-9999px";
    hiddenFrame.style.visibility = "hidden";
    document.body.appendChild(hiddenFrame);
    const doc = hiddenFrame.contentWindow?.document;
    if (!doc) { hiddenFrame.remove(); onFallback?.(); return; }
    doc.open();
    doc.write(html);
    doc.close();
    const handleAfter = () => {
      setTimeout(() => { try { hiddenFrame.remove(); } catch { /* no-op */ } }, 300);
    };
    hiddenFrame.contentWindow?.addEventListener("afterprint", handleAfter);
    setTimeout(() => {
      try { hiddenFrame.contentWindow?.focus(); hiddenFrame.contentWindow?.print(); }
      catch { hiddenFrame.remove(); onFallback?.(); }
    }, 120);
  } catch {
    onFallback?.();
  }
}
`;

// Find the end of fillReceiptPlaceholders function
const fillEnd = '    .replace(/{{\\s*paymentMethod\\s*}}/gi, sale.paymentMethod || "Unknown");\n}';
if (!content.includes('discoverPrinters')) {
  const idx = content.indexOf(fillEnd);
  if (idx !== -1) {
    content = content.slice(0, idx + fillEnd.length) + '\n' + printerHelpers + content.slice(idx + fillEnd.length);
    console.log('Added printer helpers');
  } else {
    console.log('Could not find fillReceiptPlaceholders end');
  }
}

// 2. Update ReceiptModal signature
const oldSig = 'function ReceiptModal({ sale, businessInfo, receiptTemplate, staffName, onClose }';
const newSig = 'function ReceiptModal({ sale, businessInfo, receiptTemplate, staffName, printers, defaultPrinterId, onClose }';
if (content.includes(oldSig)) {
  content = content.replace(oldSig, newSig);
  console.log('Updated ReceiptModal signature');
}

// 3. Add hasDefaultPrinter check at start of handlePrint
const oldPrintStart = '  function handlePrint() {\n    setPrintError("");\n    const w = window.open';
const newPrintStart = '  function handlePrint() {\n    setPrintError("");\n    const hasDefaultPrinter = printers.some((p) => p.id === defaultPrinterId && p.enabled);\n    if (hasDefaultPrinter) {\n      const logo = receiptTemplate.showLogo && businessInfo.logo\n        ? `<img src="${businessInfo.logo}" style="height:40px;display:block;margin:0 auto 8px;" />`\n        : "";\n      const printHtml = `\n      <html>\n        <head>\n          <title>Receipt</title>\n          <style>\n            @page { size: 80mm auto; margin: 6mm; }\n            html, body { margin: 0; padding: 0; }\n            body { font-family: \'Courier New\', monospace; font-size: 12px; width: 300px; margin: 0 auto; padding: 16px; color: #000; }\n            h2 { font-size: 14px; text-align: center; margin: 0; }\n            p { margin: 2px 0; }\n            .c { text-align: center; }\n            .s { font-size: 10px; color: #555; }\n            .line { border-top: 1px dashed #000; margin: 8px 0; }\n            .row { display: flex; justify-content: space-between; gap: 8px; }\n            .bold { font-weight: bold; }\n            .item { margin-bottom: 6px; }\n            .desc { font-size: 9px; color: #777; margin: 1px 0 2px; }\n            @media print {\n              body { width: auto; padding: 0; }\n            }\n          </style>\n        </head>\n        <body>${logo}${printRef.current?.innerHTML ?? ""}</body>\n      </html>\n    `;\n      trySilentPrint(printHtml, () => {\n        const fallbackWindow = window.open("", "_blank", "width=420,height=640");\n        if (!fallbackWindow) {\n          setPrintError("Popup blocked. Allow popups for this site and try again.");\n          return;\n        }\n        fallbackWindow.document.write(printHtml);\n        fallbackWindow.document.close();\n        const safeClose = () => {\n          setTimeout(() => {\n            try { fallbackWindow.close(); } catch { /* no-op */ }\n          }, 300);\n        };\n        fallbackWindow.addEventListener("afterprint", safeClose);\n        setTimeout(() => {\n          try {\n            fallbackWindow.focus();\n            fallbackWindow.print();\n          } catch {\n            setPrintError("Unable to open print dialog. Please print from your browser manually.");\n          }\n        }, 120);\n      });\n      return;\n    }\n\n    const w = window.open';
if (content.includes(oldPrintStart)) {
  content = content.replace(oldPrintStart, newPrintStart);
  console.log('Added silent print logic');
}

// 4. Update ReceiptModal call in POSView
const oldCall = 'staffName={staff?.name ?? ""} onClose={()=>setPendingSale(null)} />}';
const newCall = 'staffName={staff?.name ?? ""} printers={config.printers ?? []} defaultPrinterId={config.defaultPrinterId} onClose={()=>setPendingSale(null)} />}';
if (content.includes(oldCall)) {
  content = content.replace(oldCall, newCall);
  console.log('Updated ReceiptModal call');
}

// 5. Add Scan for Printers button before manual add
const oldAddBtn = 'placeholder="Printer name" className="w-full rounded-lg bg-white/5 border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50" />';
const scanBtn = `placeholder="Printer name" className="w-full rounded-lg bg-white/5 border border-border px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50" />
                      <button
                        onClick={async () => {
                          setScanningPrinters(true);
                          setPrinterMessage("");
                          try {
                            const discovered = await discoverPrinters();
                            if (discovered.length === 0) {
                              setPrinterMessage("No printers found. Make sure printers are installed on this device, then try again.");
                              return;
                            }
                            const currentNames = new Set(printers.map((p) => p.name.toLowerCase()));
                            const newOnes = discovered.filter((d) => !currentNames.has(d.name.toLowerCase()));
                            if (newOnes.length === 0) {
                              setPrinterMessage(\`Scan complete — found \${discovered.length} printer(s), all already added.\`);
                              return;
                            }
                            updateConfig({
                              printers: [...printers, ...newOnes],
                              defaultPrinterId: config.defaultPrinterId ?? newOnes[0].id,
                            });
                            setPrinterMessage(\`✓ Added \${newOnes.length} printer(s) to your list.\`);
                          } catch {
                            setPrinterMessage("Unable to scan. Your browser may not support printer discovery. Add manually below.");
                          } finally {
                            setScanningPrinters(false);
                          }
                        }}
                        disabled={scanningPrinters}
                        className="w-full rounded-lg bg-primary/20 border border-primary/30 text-primary py-2 text-xs font-semibold hover:bg-primary/30 disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        <Printer size={12} className={scanningPrinters ? "animate-pulse" : ""} />
                        {scanningPrinters ? "Scanning system printers…" : "Scan for Printers"}
                      </button>
                      {printerMessage && <p className="text-[10px] text-muted-foreground rounded-lg bg-white/3 border border-border px-3 py-2">{printerMessage}</p>}`;
if (content.includes(oldAddBtn)) {
  content = content.replace(oldAddBtn, scanBtn);
  console.log('Added Scan for Printers button');
}

// 6. Update receipt layout: item descriptions and total at top
const oldLayout = `            <div className="line" />
            {sale.items.map((o, i) => (
              <div key={i} className="item">
                <div className="row"><span className="bold">{o.menuItem.name}</span><span>{sale.currencySymbol}{o.menuItem.price.toFixed(2)}</span></div>
                {o.menuItem.description && <p className="desc">{o.menuItem.description}</p>}
                {o.qty > 1 && <div className="row"><span className="s">{o.qty} × {sale.currencySymbol}{o.menuItem.price.toFixed(2)}</span><span>{sale.currencySymbol}{(o.menuItem.price * o.qty).toFixed(2)}</span></div>}
              </div>
            ))}
            <div className="line" />
            <div className="row"><span>Subtotal</span><span>{sale.currencySymbol}{sale.subtotal.toFixed(2)}</span></div>
            {sale.tax > 0 && <div className="row"><span>VAT</span><span>{sale.currencySymbol}{sale.tax.toFixed(2)}</span></div>}
            <div className="line" />
            <div className="row bold"><span>TOTAL</span><span>{sale.currencySymbol}{sale.totalConverted.toFixed(2)}</span></div>`;

const newLayout = `            <div className="line" />
            {/* Item descriptions at the top */}
            {sale.items.map((o, i) => (
              <div key={i} className="item">
                <div className="row"><span className="bold">{o.qty} × {o.menuItem.name}</span><span>{sale.currencySymbol}{(o.menuItem.price * o.qty).toFixed(2)}</span></div>
                {o.menuItem.description && <p className="desc">{o.menuItem.description}</p>}
              </div>
            ))}
            <div className="line" />
            {/* Total at the top */}
            <div className="row bold"><span>TOTAL</span><span>{sale.currencySymbol}{sale.totalConverted.toFixed(2)}</span></div>
            <div className="line" />
            {/* Detailed breakdown listed down below */}
            <div className="row"><span>Subtotal</span><span>{sale.currencySymbol}{sale.subtotal.toFixed(2)}</span></div>
            {sale.tax > 0 && <div className="row"><span>VAT</span><span>{sale.currencySymbol}{sale.tax.toFixed(2)}</span></div>}`;

if (content.includes(oldLayout)) {
  content = content.replace(oldLayout, newLayout);
  console.log('Updated receipt layout');
}

writeFileSync(file, content, 'utf8');
console.log('All changes applied successfully.');