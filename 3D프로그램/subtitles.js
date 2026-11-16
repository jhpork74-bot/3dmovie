'use strict';
function normalizeCues(cues){return (Array.isArray(cues)?cues:[]).slice(0,2000).map(c=>({start:Math.max(0,Number(c.start)||0),end:Math.max(0,Number(c.end)||0),text:String(c.text||'').slice(0,1000)})).filter(c=>c.end>c.start&&c.text.trim());}
function assTime(t){const cs=Math.round(Math.max(0,t)*100);return `${Math.floor(cs/360000)}:${String(Math.floor(cs/6000)%60).padStart(2,'0')}:${String(Math.floor(cs/100)%60).padStart(2,'0')}.${String(cs%100).padStart(2,'0')}`;}
function assColor(value,fallback){const s=/^#[a-f0-9]{6}$/i.test(value||'')?value:fallback;return '&H00'+s.slice(5,7)+s.slice(3,5)+s.slice(1,3);}
function makeAss(cues,style={},width=1920,height=1080){const size=Math.max(16,Math.min(100,Number(style.fontSize)||40)),alignment=style.position==='top'?8:style.position==='center'?5:2;
  const header=`[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Noto Sans CJK KR,${size},${assColor(style.color,'#ffffff')},&H000000FF,${assColor(style.outlineColor,'#000000')},&H90000000,0,0,0,0,100,100,0,0,1,2,1,${alignment},40,40,50,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  return header+normalizeCues(cues).map(c=>`Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${c.text.replace(/[{}]/g,'').replace(/\\/g,'／').replace(/\r?\n/g,'\\N')}`).join('\n')+'\n';
}
module.exports={normalizeCues,makeAss};
