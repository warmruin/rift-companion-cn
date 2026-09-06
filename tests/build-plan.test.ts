import {describe,expect,it} from 'vitest';
import {parseBuildPage} from '../electron/stats';

const html=`<html><head><meta name="description" content="Ahri build for patch 16.17."/></head><body>
<script>self.__next_f.push([1,"{\\"play\\":91113,\\"pick_rate\\":0.51,\\"win_rate\\":0.5208,\\"primary_rune\\":{\\"id\\":8112,\\"name\\":\\"Electrocute\\"},\\"importClientData\\":{\\"championKey\\":\\"ahri\\",\\"primaryStyleId\\":8100,\\"subStyleId\\":8200,\\"selectedPerkIds\\":[8112,8139,8140,8106,8210,8226,5005,5008,5001]}}"])</script>
<table><caption>SummonerSpells Table</caption><tbody><tr><td><img alt="Flash" src="/summoner/4.png"/><img alt="Ignite" src="/summoner/14.png"/></td><td>51%</td><td>52%</td></tr></tbody></table>
<table><caption>SkillOrder Table</caption><tbody><tr><td><img alt="Orb of Deception"/><img alt="Fox-Fire"/><img alt="Charm"/>QWEWQ</td><td>62%</td><td>58%</td></tr></tbody></table>
<table><caption>Items Table</caption><tbody><tr><td><img alt="Doran's Ring" src="/item/1056.png"/><img alt="Health Potion" src="/item/2003.png"/></td><td>51%</td></tr></tbody></table>
<table><caption>Boots Table</caption><tbody><tr><td><img alt="Sorcerer's Shoes" src="/item/3020.png"/></td><td>52%</td></tr></tbody></table>
<table><caption>Builds Table</caption><tbody><tr><td><img alt="Malignance" src="/item/3118.png"/><img alt="Shadowflame" src="/item/4645.png"/><img alt="Zhonya's Hourglass" src="/item/3157.png"/></td><td>53%</td></tr></tbody></table>
</body></html>`;

describe('OP.GG build parser',()=>{
 it('returns a complete applicable rune and item plan',()=>{
  const [plan]=parseBuildPage(html,103,'Ahri','mid','https://op.gg/lol/champions/ahri/build/mid');
  expect(plan).toMatchObject({championId:103,role:'mid',primaryStyleId:8100,subStyleId:8200,perkIds:[8112,8139,8140,8106,8210,8226,5005,5008,5001],summonerSpellIds:[4,14],starterItemIds:[1056,2003],bootItemIds:[3020],coreItemIds:[3118,4645,3157],skillOrder:'QWEWQ',patch:'16.17'});
 });

 it('rejects pages without a complete rune selection',()=>{
  expect(()=>parseBuildPage('<meta name="description" content="patch 16.17"><table></table>',103,'Ahri','mid','https://op.gg')).toThrow(/rune/i);
 });
});
