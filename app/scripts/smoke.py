"""Verificacao de fumaca do Musa CRM.
Uso:  SENHA=... python3 scripts/smoke.py [arquivo-de-saida]
Compara com:  diff base.txt depois.txt
"""
import json, os, sys, urllib.request

BASE = 'https://demo-musa.mulinotech.com'
EMAIL = os.environ.get('EMAIL', 'silvia@inpyx.com')

def chamar(metodo, caminho, corpo=None, token=None):
    cab = {'Content-Type': 'application/json'}
    if token: cab['Authorization'] = 'Bearer ' + token
    r = urllib.request.Request(BASE + caminho,
        data=json.dumps(corpo).encode() if corpo is not None else None,
        headers=cab, method=metodo)
    try:
        resp = urllib.request.urlopen(r)
        dados = resp.read()
        try:
            j = json.loads(dados or b'null')
            forma = ('lista[%d]' % len(j)) if isinstance(j, list) else ('objeto{%d}' % len(j)) if isinstance(j, dict) else type(j).__name__
        except Exception:
            forma = '%d bytes' % len(dados)
        return resp.status, forma
    except Exception as e:
        return getattr(e, 'code', 0), 'erro'

token = chamar('POST', '/api/auth/login', {'email': EMAIL, 'password': os.environ['SENHA']})
tk = None
if token[0] == 200:
    r = urllib.request.Request(BASE + '/api/auth/login',
        data=json.dumps({'email': EMAIL, 'password': os.environ['SENHA']}).encode(),
        headers={'Content-Type': 'application/json'})
    tk = json.loads(urllib.request.urlopen(r).read())['token']

CASOS = [
    ('GET',  '/',                                    None, False),
    ('GET',  '/api/config',                          None, False),
    ('GET',  '/api/clients',                         None, False),   # sem token: espera 401
    ('GET',  '/api/logs',                            None, True),
    ('GET',  '/api/leads',                           None, True),
    ('GET',  '/api/salespeople',                     None, True),
    ('GET',  '/api/treatment-catalog',               None, True),
    ('GET',  '/api/clients',                         None, True),
    ('GET',  '/api/treatments',                      None, True),
    ('GET',  '/api/treatment-plans',                 None, True),
    ('GET',  '/api/interactions',                    None, True),
    ('GET',  '/api/evolution/instances',             None, True),
    ('GET',  '/api/evolution/status',                None, True),
    ('GET',  '/api/users',                           None, True),
    ('POST', '/api/reports/generate',   {'aba': 'dashboard'}, True),
    ('POST', '/api/_migrate?status=1',                  {}, True),
]

linhas = []
for metodo, caminho, corpo, autenticado in CASOS:
    st, forma = chamar(metodo, caminho, corpo, tk if autenticado else None)
    linhas.append('%-6s %-38s %-6s %3d  %s' % (metodo, caminho, 'token' if autenticado else 'anon', st, forma))

saida = '\n'.join(linhas)
print(saida)
if len(sys.argv) > 1:
    open(sys.argv[1], 'w').write(saida + '\n')
    print('\nsalvo em ' + sys.argv[1])
