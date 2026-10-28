import json, re
import os
root=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))+'/'
html=open(root+'meetings.html',encoding='utf-8').read()
css=open(root+'style.css',encoding='utf-8').read()+'\n'+open(root+'meetings.css',encoding='utf-8').read()
def js(f): return open(root+f,encoding='utf-8',errors='strict').read().replace('</script','<\\/script')
progs=json.load(open(root+'data/iub-programs.json'))
html=html.replace('<link rel="stylesheet" href="style.css">\n  <link rel="stylesheet" href="meetings.css">', '<style>\n'+css+'\n</style>')
html=html.replace('<a class="tablink" href="index.html">← LFE home</a>','<a class="tablink" href="https://coordinatorlfe-ops.github.io/LFE-OFFICIAN/" target="_blank" rel="noopener">LFE site ↗</a>')
html=html.replace('<script src="vendor/jspdf.umd.min.js"></script>','<script>\n'+js('vendor/jspdf.umd.min.js')+'\n</script>')
html=html.replace('<script src="vendor/xlsx.full.min.js"></script>','<script>\n'+js('vendor/xlsx.full.min.js')+'\n</script>')
html=html.replace('<script src="meetings.js"></script>','<script>window.IUB_PROGRAMS = '+json.dumps(progs)+';</script>\n<script>\n'+js('meetings.js')+'\n</script>')
assert 'src="' not in re.sub(r'<script>.*?</script>','',html,flags=re.S), 'external ref left'
assert 'href="style.css"' not in html
open(root+'LFE_Meeting_Records.html','w',encoding='utf-8').write(html)
print(len(html)//1024,'KB')
