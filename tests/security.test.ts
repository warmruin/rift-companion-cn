import {it,expect} from 'vitest';
import {validateStatsArgs,allowedSource} from '../electron/security';
it('only accepts known roles and integer champion IDs',()=>{expect(()=>validateStatsArgs('foo',1)).toThrow();expect(()=>validateStatsArgs('top','../x')).toThrow();expect(validateStatsArgs('mid',103)).toEqual({role:'mid',opponentId:103});});
it('only opens official source hosts over HTTPS',()=>{expect(allowedSource('https://op.gg/lol/champions')).toBe(true);expect(allowedSource('https://op.gg.evil.com/')).toBe(false);expect(allowedSource('file:///C:/Windows/')).toBe(false);expect(allowedSource('https://user:pass@op.gg/')).toBe(false);});
