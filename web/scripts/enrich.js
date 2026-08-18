const http = require('http')
// A stand-in vision model that answers per garment, keyed off the title it is
// given — so the profiles differ and the composition has something real to do.
const BY_TITLE = {
  'Boxy Linen Camp Shirt':      { garment:'shirt', fit:'relaxed', volume:'boxy',   fabric:'linen', weight:'light', drape:'fluid',  pattern:'plain',  patternScale:'none',  colour:'ecru',        formality:2, aesthetic:'resort',   season:'summer', details:['camp collar','short sleeve'], quality:2 },
  'Large Floral Rayon Shirt':   { garment:'shirt', fit:'relaxed', volume:'boxy',   fabric:'blend', weight:'light', drape:'fluid',  pattern:'floral', patternScale:'large', colour:'cream',       formality:2, aesthetic:'resort',   season:'summer', details:['open collar'], quality:1 },
  'Wide Cream Cotton Trousers': { garment:'trouser', fit:'wide',  volume:'boxy',   fabric:'cotton', weight:'light', drape:'fluid', pattern:'plain',  patternScale:'none',  colour:'cream',       formality:2, aesthetic:'minimal',  season:'summer', details:['wide leg','pleated front'], quality:2 },
  'Large Check Wool Trousers':  { garment:'trouser', fit:'wide',  volume:'boxy',   fabric:'wool',  weight:'heavy', drape:'structured', pattern:'check', patternScale:'large', colour:'charcoal', formality:3, aesthetic:'tailored', season:'winter', details:['wide leg'], quality:2 },
  'White Leather Sneakers':     { garment:'sneaker', fit:'regular', volume:'fitted', fabric:'leather', weight:'mid', drape:'structured', pattern:'plain', patternScale:'none', colour:'white',  formality:2, aesthetic:'minimal',  season:'all',    details:['low top'], quality:2 },
  'Black Patent Dress Shoes':   { garment:'derby',  fit:'slim',   volume:'fitted', fabric:'leather', weight:'mid', drape:'structured', pattern:'plain', patternScale:'none', colour:'black',   formality:5, aesthetic:'tailored', season:'all',    details:['lace up'], quality:3 },
}
const server = http.createServer((req,res) => {
  let b=''; req.on('data',c=>b+=c)
  req.on('end',()=>{
    const t = Object.keys(BY_TITLE).find(k => b.includes(k))
    res.writeHead(200,{'Content-Type':'application/json'})
    res.end(JSON.stringify({ choices:[{ message:{ role:'assistant',
      content: JSON.stringify(BY_TITLE[t] || BY_TITLE['Boxy Linen Camp Shirt']) } }] }))
  })
})
server.listen(4949, async () => {
  process.env.GROQ_API_KEY='mock'; process.env.GROQ_BASE_URL='http://127.0.0.1:4949'
  const { profilesFor } = require('/home/user/From/web/.vt/en.cjs')
  const { worksWith } = require('/home/user/From/web/.vt/gp.cjs')
  const P=(id,title)=>({id,title,description:'',image_url:'https://cdn.shopify.com/'+id+'.jpg'})
  const products=[
    P('a','Boxy Linen Camp Shirt'), P('b','Large Floral Rayon Shirt'),
    P('c','Wide Cream Cotton Trousers'), P('d','Large Check Wool Trousers'),
    P('e','White Leather Sneakers'), P('f','Black Patent Dress Shoes'),
  ]
  const t0=Date.now()
  const profiles = await profilesFor(products)
  console.log(`read ${profiles.size} garments in ${Date.now()-t0}ms\n`)
  const one = profiles.get('a')
  console.log('WHAT IT NOW KNOWS ABOUT ONE GARMENT (Boxy Linen Camp Shirt):')
  Object.entries(one).filter(([k])=>k!=='readAt').forEach(([k,v])=>console.log(`   ${k.padEnd(13)} ${Array.isArray(v)?v.join(', '):v}`))

  const t1=Date.now(); await profilesFor(products)
  console.log(`\nsecond time: ${Date.now()-t1}ms (remembered)\n`)

  console.log('AND HOW IT NOW JUDGES COMBINATIONS:')
  const pairs=[['a','c','camp shirt + wide cream trousers'],['b','d','large floral + large check'],
               ['a','f','linen camp shirt + patent dress shoes'],['a','e','camp shirt + white sneakers'],
               ['b','c','large floral shirt + plain cream trousers']]
  pairs.map(([x,y,n])=>({n,s:worksWith(profiles.get(x),profiles.get(y))}))
    .sort((p,q)=>q.s-p.s).forEach(r=>console.log('   '+String(r.s).padEnd(7)+r.n))
  server.close()
})
