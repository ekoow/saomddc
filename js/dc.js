var DC = (function () {
    var db;
    var sd;
    var lvup_rate = 0.005245;
    var lb_rate = {
        normal: 0.025775,
        high: 0.041275
    }
    var key_mp = 'mp';
    var key_bs_mp = 'bs_mp';
    var key_mp_dec = 'mp_dec';
    var key_e_mp_dec = 'e_mp_dec';
    var key_atk = 'atk';
    var key_bs_atk = 'bs_atk';

    function loadData(raw) {
        db = raw;
        //init relation
        for (var i = 0; i < db.relation.length; i++) {
            var rel = db.relation[i];
            refer(db[rel.src], db[rel.dst], rel.key);
        }
        //init condition object
        createConditionObject(db.armor, 'conditional');
        createConditionObject(db.accessory, 'conditional');
        createConditionObject(db.preset, 'condition');
        //init static data
        sd = {};
        return db;
    }

    function getData() {
        return db;
    }

    function refer(src, dst, key) {
        for (var i in src) {
            var value = src[i][key];
            src[i][key] = dst[value];
        }
    }

    function createConditionObject(object, key) {
        for (var i in object) {
            var condition_string = object[i][key];
            if (condition_string !== 0) {
                var conditions = []
                var condition_src = condition_string.split(/,/);
                for (var j in condition_src) {
                    var condition = {};
                    var sp = condition_src[j].split(/:/);
                    condition.expression = sp[0];
                    var values = sp[1].split(/&/);
                    condition.values = {};
                    for (var k in values) {
                        var kv = values[k].split(/=/);
                        condition.values[kv[0]] = parse(kv[1]);
                    }
                    conditions.push(condition);
                }
                object[i][key] = conditions;
            }
        }
    }

    function evalConditions(conditions, data) {
        var values = {};
        for (var i in conditions) {
            var condition = conditions[i];
            if (Expression.eval(condition.expression, data)) {
                for (var key in condition.values) {
                    if (values[key]) {
                        values[key] += condition.values[key];
                    } else {
                        values[key] = condition.values[key];
                    }
                }
            }
        }
        return values;
    }

    function estimateDef(opts) {
        var total = 0;
        for(var opt of opts){            
            total+=calcDef(opt.c, opt.lv, opt.lb, opt.wep, opt.r, opt.amr, opt.acc, opt.boss, opt.damage);
        }
        return total/opts.length;
    }
    function estimateMod(opts) {
        var total = 0;
        for(var opt of opts){            
            total+=calcMod(opt.c, opt.lv, opt.lb, opt.wep, opt.r, opt.amr, opt.acc, opt.boss, opt.damage);
        }
        return total/opts.length;
    }

    function calcDef(c, lv, lb, wep, r, amr, acc, boss, damage) {
        var dcv = getDamageCalculationVariables(c, lv, lb, wep, r, amr, acc, boss);
        dcv.def = (dcv.atk * dcv.atk_mod + dcv.atk_ss) * (dcv.rate * dcv.crit * dcv.elem * dcv.mod * dcv.combo / dcv.guard) / dcv.damage;
        return dcv;
    }

    function calcMod(c, lv, lb, wep, r, amr, acc, boss, damage) {
        var dcv = getDamageCalculationVariables(c, lv, lb, wep, r, amr, acc, boss);
        dcv.mod = dcv.damage * dcv.guard / ((dcv.atk * dcv.atk_mod + dcv.atk_ss - dcv.def) * dcv.rate * dcv.crit * dcv.elem * dcv.combo);
        return dcv;
    }

    function calcRate(c, lv, lb, wep, r, amr, acc, boss, damage) {
        var dcv = getDamageCalculationVariables(c, lv, lb, wep, r, amr, acc, boss);
        dcv.rate = damage / ((dcv.atk * dcv.atk_mod + dcv.atk_ss - dcv.def) * dcv.mod * dcv.crit * dcv.elem * dcv.combo / dcv.guard);
        return dcv;
    }

    function calcDamage(c, lv, lb, wep, r, amr, acc, boss, custom_rate) {
        var dcv = getDamageCalculationVariables(c, lv, lb, wep, r, amr, acc, boss);
        if (custom_rate) {
            dcv.rate = custom_rate;
        }
        dcv.damage = (dcv.atk * dcv.atk_mod + dcv.atk_ss - dcv.def) * dcv.rate * dcv.crit * dcv.elem * dcv.mod * dcv.combo / dcv.guard;
        return dcv;
    }

    function getDamageCalculationVariables(c, lv, lb, wep, r, amr, acc, boss) {
        var sv = getSV(c, lv, lb, wep, r, amr, acc);
        var sve = sv['default'];
        if (boss.element) {
            sve = sv[boss.element.id];
        }

        var exp_obj = {
            c: c,
            hp: 100,
            vs: boss.element ? boss.element.id : undefined,
            combo: boss.combo,
            switched: boss.switched
        };
        var bs_con_amr = amr ? evalConditions(amr.conditional, exp_obj) : {};
        var bs_con_acc = acc ? evalConditions(acc.conditional, exp_obj) : {};
        var atk = sv.atk + getEqValue(bs_con_amr, key_atk) + getEqValue(bs_con_acc, key_atk);
        var atk_mod = sve.bs_atk + getEqValue(bs_con_amr, key_bs_atk) + getEqValue(bs_con_acc, key_bs_atk);

        if (boss.gbuff === undefined) {
            atk_mod += sv.c.s3_atk;
        } else {
            atk_mod += Math.max(sv.c.s3_atk, boss.gbuff);
        }
        if (boss.cbuff === undefined) {
            atk_mod += sv.c.s3_catk;
        } else if (sv.c.s3_catk > 0) {
            atk_mod += sv.c.s3_catk;
        } else {
            atk_mod += boss.cbuff;
        }
        atk_mod += boss.trophy;
        atk_mod += boss.ls;
        atk_mod += 1;

        var debuff = 1.0;
        if (boss.debuff) {
            debuff = boss.debuff;
        }

        var def;
        if (boss.debuff < 1.0) { //debuff on
            def = boss.def * debuff;
        } else { //debuff off
            def = boss.def * (1 - sv.c.s3_debuf_pnr + sv.c.s3_debuf * sv.c.s3_debuf_pnr);
        }

        var elem = 1; //primary elem: it is multiplied to damage
        var emod = 0; //sub elem modifier: it is added to damage modifiers  
        if (sve.eRate) {
            elem += boss[sve.eRate];
        }
        for (var e in db.element) {
            if (e === sv.c.element.id) {
                emod += boss[e];
            }
        }

        var dtmod = 0; // damage type modifier
        for (var t in db.dtype) {
            dtmod += boss[t] * sv.dtmod[t];
        }

        var wtmod = boss[c.type.wtype]; // weapon type moodifier

        var conditionalMod = evalConditions(boss.condition, exp_obj).mod;
        if (conditionalMod === undefined) {
            conditionalMod = 0;
        }

        var crit = 1.0;
        var mod_cri_dmg = 0.0;
        if (boss.crit > 0) {
            crit = sve.crit;
            mod_cri_dmg = sve.mod_cri_dmg;
            if (boss.gcrit === undefined) {
                mod_cri_dmg += sv.c.ss_gcri_dmg;
            } else {
                mod_cri_dmg += Math.max(sv.c.ss_gcri_dmg, boss.gcrit);
            }
        }

        var combo = 1 + Math.floor(boss.combo / 10) * 0.05;
        var comboMod = 0.0; // BS from the Ccondition of Combo
        if (boss.combo >= 20) {
            comboMod += sv.c.combo_damage_20;
            if (wep) {
                comboMod += wep.c20_bs_cri_dmg;
            }
        }
        if (boss.combo >= 30) {
            comboMod += sv.c.combo_damage_30;
        }

        var mod = Math.min(1.0 + sve.mod_dmg + mod_cri_dmg + emod + dtmod + wtmod + boss.repRate + boss.racc + boss.etcMod + conditionalMod + comboMod, boss.limit);

        var dcv = {
            atk: atk,
            atk_ss: sv.atk_ss,
            atk_mod: atk_mod,
            def: def,
            rate: sv.c.s3_rate,
            mod: mod,
            crit: crit,
            elem: elem,
            combo: combo,
            guard: boss.guard,
            sv: sv
        };
        return dcv;
    }

    function getSV(c, lv, lb, wep, r, amr, acc) {
        var obj = sd;
        obj = getSubObject(obj, c.id);
        obj = getSubObject(obj, lv);
        obj = getSubObject(obj, lb);
        obj = getSubObject(obj, wep ? wep.id : 'undefined');
        obj = getSubObject(obj, r);
        obj = getSubObject(obj, amr ? amr.id : 'undefined');
        obj = getSubObject(obj, acc ? acc.id : 'undefined');
        if (Object.keys(obj).length <= 0) {
            obj = createSV(c, lv, lb, wep, r, amr, acc, obj);
        }
        return obj;
    }

    function getSubObject(obj, key) {
        if (obj[key] === undefined) {
            obj[key] = {};
        }
        return obj[key];
    }

    function createSV(c, lv, lb, wep, r, amr, acc, sv) {
        sv.c = c;
        sv.lv = lv;
        sv.wep = wep;
        sv.r = r;
        sv.amr = amr;
        sv.acc = acc;
        sv.mp = Math.floor((c.mp + getEqValueWithElem(c, amr, key_mp) + getEqValueWithElem(c, acc, key_mp)) * (1 + c.bs_mp + getEqValue(amr, key_bs_mp) + getEqValue(acc, key_bs_mp)));
        sv.mpr = sv.mp * c.type.mpr;
        sv.cost = c.s3_mp - c.s3_mp * getWeaponMpDec(c, wep);

        var lv_dif = lv - 80;
        sv.atk_ss = c.ss_atk;
        if (lv > 80) {
            sv.atk_ss += c.ss_atk_85;
        }
        sv.lb = Math.min(lb, Math.floor(lv_dif / 5))
        sv.atk_c = c.atk + c.atk * lv_dif * lvup_rate + c.atk * sv.lb * lb_rate[c.lvup];
        sv.atk_eq = getWeaponAtk(c, wep, r) + getEqValueWithElem(c, amr, key_atk) + getEqValueWithElem(c, acc, key_atk);
        sv.atk = sv.atk_c + sv.atk_eq;
        createSVE(sv, 'default');
        for (var elem in db.element) {
            createSVE(sv, elem);
        }
        sv.dtmod = {}
        for (var t in db.dtype) {
            sv.dtmod[t] = c['dtr_' + t];
        }
        return sv;
    }

    function createSVE(sv, elem) {
        var sve = {};
        sv[elem] = sve;
        sve.bs_atk_eq = getWeaponBSAtk(sv.wep, sv.r) + getEqValue(sv.amr, key_bs_atk) + getEqValue(sv.acc, key_bs_atk);
        sve.bs_atk = sv.c.bs_atk + sve.bs_atk_eq;
        sve.mod_dmg = sv.c.ss_dmg;
        sve.crit = sv.c.cri_dmg;
        sve.mod_cri_dmg = getWeaponCriEDmg(sv.wep, sv.r, sv.c, elem);
        sve.eRate = getElementERate(sv.c.element, elem);
        if (sve.eRate === 'epRate' || elem === 'default') {
            sve.mod_dmg += sv.c.ss_elem_dmg;
            if (sv.lv > 85) {
                sve.mod_dmg += sv.c.ss_elem_dmg_90;
            }
            sve.mod_cri_dmg += sv.c.ss_elem_cri_dmg;
        }
    }

    function getElementERate(c_elem, boss_elem_id) {
        var eRate;
        if (c_elem.weak === boss_elem_id) {
            eRate = 'enRate';
        }
        if (c_elem.strong === boss_elem_id) {
            eRate = 'epRate';
        }
        return eRate;
    }

    function getWeaponAtk(c, wep, r) {
        var atk = getEqValueWithElem(c, wep, key_atk);
        switch (r) {
            case 4:
                return atk * 1;
            case 5:
                return atk * 1.36;
            default:
                return atk * 0;
        }
    }

    function getWeaponBSAtk(wep, r) {
        if (wep) {
            switch (r) {
                case 4:
                    return wep.bs_atk;
                case 5:
                    return wep.bs_atk5;
                default:
                    return 0;
            }
        }
        return 0;
    }

    function getWeaponCriEDmg(wep, r, c, vs) {
        var mod = 0;
        if (wep) {
            if (c.element === wep.element) {
                switch (r) {
                    case 4:
                        mod += wep.e_bs_cri_dmg;
                        break;
                    case 5:
                        mod += wep.e_bs_cri_dmg5;
                        break;
                    default:
                }
            }
            if (wep.element.strong === vs) {
                switch (r) {
                    case 4:
                        mod += wep.bs_cri_edmg;
                        break;
                    case 5:
                        mod += wep.bs_cri_edmg5;
                        break;
                    default:
                }
            }
        }
        return mod;
    }

    function getWeaponMpDec(c, wep) {
        var mpdec = 0;
        if (wep) {
            mpdec += getEqValue(wep, key_mp_dec);
            if (c.element === wep.element) {
                mpdec += getEqValue(wep, key_e_mp_dec);
            }
        }
        return mpdec;
    }

    function getEqValueWithElem(c, eq, key) {
        var value = getEqValue(eq, key);
        if (value && c.element === eq.element) {
            return value * 1.2;
        } else {
            return value;
        }
    }

    function getEqValue(eq, key) {
        if (eq === undefined || eq[key] === undefined) {
            return 0;
        }
        return eq[key];
    }

    function get(itemKey, mKey, mValue) {
        var items = db[itemKey];
        for (var i in items) {
            var item = items[i];
            if (item[mKey] === mValue) {
                return item;
            }
        }
        return undefined;
    }

    function getChar(id) {
        if (id) {
            return db.base[id];
        }
        return db.base;
    }

    function getWeapon(id) {
        if (id) {
            return db.weapon[id];
        }
        return db.weapon;
    }

    function getArmor(id) {
        if (id) {
            return db.armor[id];
        }
        return db.armor;
    }

    function getAccessory(id) {
        if (id) {
            return db.accessory[id];
        }
        return db.accessory;
    }

    function getBoss(name) {
        if (name) {
            return get('preset', 'name', name);
        }
        return db.preset;
    }

    function getCname(id) {
        if (id) {
            return db.cname[id];
        }
        return db.cname;
    }

    function getElement(id) {
        if (id) {
            return db.element[id];
        }
        return db.element;
    }

    function getType(id) {
        if (id) {
            return db.type[id];
        }
        return db.type;
    }

    function getDtype(id) {
        if (id) {
            return db.dtype[id];
        }
        return db.dtype;
    }
    return {
        loadData: loadData,
        getData: getData,
        getSV: getSV,
        calcRate: calcRate,
        calcDamage: calcDamage,
        get: get,
        getChar: getChar,
        getWeapon: getWeapon,
        getArmor: getArmor,
        getAccessory: getAccessory,
        getBoss: getBoss,
        getCname: getCname,
        getElement: getElement,
        getType: getType,
        getDtype: getDtype
    }
})();