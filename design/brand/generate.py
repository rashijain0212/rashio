import math, os
OUT=os.path.dirname(os.path.abspath(__file__))
def pt(cx,cy,r,a): return (round(cx+r*math.cos(math.radians(a)),2), round(cy+r*math.sin(math.radians(a)),2))
def cmark(cx=26,cy=32,r=14,w=10,top='#6C5CE7',bot='#88ABF5',sparkle=True,chime=True,gold='#FFC857',mint='#5CCB9C'):
    # Two flat arcs meeting at a diagonal seam (200 deg); only the open ends are rounded.
    seam=200
    a1=pt(cx,cy,r,-40); s1=pt(cx,cy,r,seam-360)
    b1=pt(cx,cy,r,40)
    s=[f'<path d="M{a1[0]} {a1[1]}A{r} {r} 0 0 0 {s1[0]} {s1[1]}" fill="none" stroke="{top}" stroke-width="{w}"/>',
       f'<circle cx="{a1[0]}" cy="{a1[1]}" r="{w/2}" fill="{top}"/>',
       f'<path d="M{b1[0]} {b1[1]}A{r} {r} 0 0 1 {s1[0]} {s1[1]}" fill="none" stroke="{bot}" stroke-width="{w}"/>',
       f'<circle cx="{b1[0]}" cy="{b1[1]}" r="{w/2}" fill="{bot}"/>']
    if sparkle:
        x,y=cx+18,cy
        s.append(f'<path d="M{x} {y-5.5}Q{x+.9} {y-.9} {x+5.5} {y}Q{x+.9} {y+.9} {x} {y+5.5}Q{x-.9} {y+.9} {x-5.5} {y}Q{x-.9} {y-.9} {x} {y-5.5}Z" fill="{gold}"/>')
    if chime:
        x=cx+25
        s.append(f'<path d="M{x} {cy-8}l4-3.2M{x+1} {cy}h5M{x} {cy+8}l4 3.2" stroke="{mint}" stroke-width="2.6" stroke-linecap="round" fill="none"/>')
    return ''.join(s)
def svg(vb,body,title='ChaChing'):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" aria-label="{title}"><title>{title}</title>{body}</svg>\n'
TILE='<rect width="64" height="64" rx="16" fill="#EAE6FF"/>'
FONT='font-family="Inter, -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, Arial, sans-serif" font-weight="700"'
files={
 'chaching-symbol.svg': svg('0 0 64 64', cmark()),
 'chaching-app-icon.svg': svg('0 0 64 64', TILE+cmark()),
 'chaching-favicon.svg': svg('0 0 64 64', TILE+cmark(cx=32,cy=32,r=15,w=12,sparkle=False,chime=False)),
 'chaching-favicon-32.svg': svg('0 0 64 64', TILE+cmark(cx=28,cy=32,r=14,w=11,chime=False)),
 'chaching-mono.svg': svg('0 0 64 64', cmark(top='#344054',bot='#344054',gold='#344054',mint='#344054')),
 'chaching-lockup.svg': svg('0 0 300 64', cmark()+f'<text x="70" y="44" {FONT} font-size="34" fill="#344054" letter-spacing="-0.5">ChaChing</text>'),
 'chaching-lockup-dark.svg': svg('0 0 300 64', '<rect width="300" height="64" rx="12" fill="#1F2430"/>'+cmark(top='#9D90F5',bot='#A8C2FA')+f'<text x="70" y="44" {FONT} font-size="34" fill="#FFFFFF" letter-spacing="-0.5">ChaChing</text>'),
 'chaching-mono-lockup.svg': svg('0 0 300 64', cmark(top='#344054',bot='#344054',gold='#344054',mint='#344054')+f'<text x="70" y="44" {FONT} font-size="34" fill="#344054" letter-spacing="-0.5">ChaChing</text>'),
}
for n,c in files.items(): open(os.path.join(OUT,n),'w').write(c)
# brand sheet 1024
sw=[('#6C5CE7','Brand accent'),('#5145CD','Primary action'),('#EAE6FF','Brand surface'),('#88ABF5','Soft blue'),('#FFC857','Spark'),('#5CCB9C','Chime'),('#344054','Ink'),('#DCEBFF','Earnings'),('#DDF5E3','Paid'),('#FFE9BF','Pending'),('#F5E1F8','Incentives'),('#F6EBDD','Table header')]
body='<rect width="1024" height="1024" fill="#FAFAFC"/>'
body+=f'<g transform="translate(64 64) scale(5)">{TILE+cmark()}</g>'
body+=f'<g transform="translate(424 96) scale(1.9)">{cmark()}<text x="70" y="44" {FONT} font-size="34" fill="#344054" letter-spacing="-0.5">ChaChing</text></g>'
body+=f'<text x="436" y="262" {FONT.replace("700","500")} font-size="26" fill="#344054" font-style="italic">Every hour. Every earning.</text>'
body+=f'<text x="436" y="300" {FONT.replace("700","400")} font-size="20" fill="#667085">Your personal income intelligence.</text>'
body+=f'<text x="64" y="452" {FONT.replace("700","600")} font-size="16" fill="#667085">ACTUAL SIZES</text>'
x=64
for size,f in [(180,'app'),(64,'app'),(32,'fav32'),(16,'fav')]:
    inner = TILE+(cmark() if f=='app' else cmark(cx=28,cy=32,r=14,w=11,chime=False) if f=='fav32' else cmark(cx=32,cy=32,r=15,w=12,sparkle=False,chime=False))
    body+=f'<g transform="translate({x} 476) scale({size/64})">{inner}</g><text x="{x}" y="{476+size+22}" {FONT.replace("700","400")} font-size="14" fill="#667085">{size}px</text>'
    x+=size+40
body+=f'<g transform="translate(560 476) scale(1.2)">{cmark(top="#344054",bot="#344054",gold="#344054",mint="#344054")}</g><text x="560" y="578" {FONT.replace("700","400")} font-size="14" fill="#667085">Monochrome</text>'
body+=f'<g transform="translate(680 476)"><rect width="300" height="64" rx="12" fill="#1F2430"/>{cmark(top="#9D90F5",bot="#A8C2FA")}<text x="70" y="44" {FONT} font-size="34" fill="#FFFFFF">ChaChing</text></g><text x="680" y="578" {FONT.replace("700","400")} font-size="14" fill="#667085">Dark background asset</text>'
body+=f'<text x="64" y="726" {FONT.replace("700","600")} font-size="16" fill="#667085">PALETTE</text>'
for i,(h,n) in enumerate(sw):
    cx=64+(i%6)*152; cy=744+(i//6)*130
    body+=f'<rect x="{cx}" y="{cy}" width="136" height="64" rx="10" fill="{h}" stroke="#E4E7EC"/><text x="{cx}" y="{cy+86}" {FONT.replace("700","600")} font-size="14" fill="#344054">{n}</text><text x="{cx}" y="{cy+106}" {FONT.replace("700","400")} font-size="13" fill="#667085">{h}</text>'
open(os.path.join(OUT,'chaching-brand-sheet.svg'),'w').write(svg('0 0 1024 1024',body,'ChaChing brand sheet'))
print('ok')
