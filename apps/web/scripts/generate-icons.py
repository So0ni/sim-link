from pathlib import Path
import struct,zlib
root=Path(__file__).resolve().parent.parent/'public/icons'
blue=(8,102,230)
def color(x,y):
 card=160<=x<=352 and 128<=y<=384 and (x<=288 or y>=x-160)
 if not card:return blue
 chip=(194<=x<=318 and 226<=y<=334 and (x<=206 or x>=306 or y<=238 or y>=322 or 274<=y<=286 or 250<=x<=262))
 return blue if chip else (255,255,255)
def chunk(kind,data):return struct.pack('!I',len(data))+kind+data+struct.pack('!I',zlib.crc32(kind+data)&0xffffffff)
for size,name in [(192,'icon-192.png'),(512,'icon-512.png'),(180,'apple-touch-icon.png')]:
 data=bytearray()
 for y in range(size):
  data.append(0)
  for x in range(size):
   values=[color((x+(i+.5)/2)*512/size,(y+(j+.5)/2)*512/size) for i in range(2) for j in range(2)]
   data.extend(round(sum(c[k] for c in values)/4) for k in range(3))
 png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!IIBBBBB',size,size,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(data,9))+chunk(b'IEND',b'')
 (root/name).write_bytes(png)
