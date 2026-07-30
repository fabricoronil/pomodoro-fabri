import "./globals.css";

export const metadata = {
  title: "Pomodoro · Fabri",
  description: "Timer pomodoro con analítica de estudio y control de sueño",
  manifest: "/manifest.json",
};

export const viewport = {
  themeColor: "#07080d",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

/**
 * Pinta el tema guardado antes del primer render para que no haya un flash del
 * tema por defecto. Es una versión mínima de lib/theme.js (misma derivación).
 */
const THEME_BOOT = `(function(){try{
var s=JSON.parse(localStorage.getItem("pf.settings")||"{}").theme;if(!s)return;
var H=function(h){h=String(h||"").replace("#","");if(h.length===3)h=h.split("").map(function(c){return c+c}).join("");var n=parseInt(h,16);return[n>>16&255,n>>8&255,n&255]};
var M=function(a,b,t){var A=H(a),B=H(b);return[0,1,2].map(function(i){return Math.round(A[i]+(B[i]-A[i])*t)})};
var L=function(h){var c=H(h).map(function(v){v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});return .2126*c[0]+.7152*c[1]+.0722*c[2]};
var base=s.base||"#07080d",ink=s.ink||"#e9ecf6",lt=L(base)>.45,r=document.documentElement,S=function(n,v){r.style.setProperty("--c-"+n,v.join(" "))};
S("base",H(base));S("ink",H(ink));
S("surface",lt?M(base,"#ffffff",.8):M(base,ink,.05));
S("surface2",lt?M(base,"#ffffff",.45):M(base,ink,.085));
S("surface3",M(base,ink,lt?.12:.14));
S("line",M(base,ink,lt?.15:.19));S("muted",M(base,ink,lt?.62:.58));
S("accent",H(s.accent||"#8b5cf6"));S("accent2",H(s.accent2||"#22d3ee"));S("focus",H(s.focus||"#f0616d"));S("rest",H(s.rest||"#34d399"));
S("rest2",M(s.rest||"#34d399",s.accent2||"#22d3ee",.5));S("warn",H(lt?"#b45309":"#fbbf24"));S("onAccent",L(s.accent||"#8b5cf6")>.35?[11,13,20]:[255,255,255]);
r.style.setProperty("--bg-intensity",String((s.bgIntensity==null?100:s.bgIntensity)/100));
r.style.setProperty("--bg-a",lt?"1.6":"1");
r.style.setProperty("--bg-blur",(s.bgBlur||0)+"px");
r.style.setProperty("--bg-dim",String((s.bgDim==null?55:s.bgDim)/100));
var img=/^(https?:\\/\\/|data:image\\/)/i.test(s.bgImage||"")?String(s.bgImage).replace(/["'\\\\\\s()]/g,encodeURIComponent):"";
r.style.setProperty("--bg-image",s.bg==="image"&&img?'url("'+img+'")':"none");
r.dataset.bg=s.bg==="image"&&!img?"solid":(s.bg||"aurora");
r.style.colorScheme=lt?"light":"dark";
}catch(e){}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="es" data-bg="aurora">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
