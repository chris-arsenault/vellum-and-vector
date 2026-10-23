import { trainMarkovChain, type Culture, type Grammar, type Profile } from "@atlas/name-forge";

/** Atlas-owned place corpora. These are spelling inspirations, not imported setting lore. */
export const namingSources = [
  {
    id: "marches",
    name: "Marcher",
    inspiration: "English market towns and river settlements",
    samples: `Ashford Bedford Beverley Bradford Brampton Brentford Bridport Bristol Bromley
      Buckingham Canterbury Chester Chichester Clifton Colchester Cranbrook Dartmouth Darlington
      Dorchester Dover Dunwich Eastleigh Ely Evesham Exeter Farnham Faversham Fordingbridge
      Gainsborough Grantham Guildford Hadleigh Harborough Hartlepool Hastings Hereford Hexham
      Horsham Huntingdon Ipswich Kendal Keswick Lancaster Langport Leominster Lewes Lichfield
      Lincoln Maidstone Malton Marlborough Melton Morpeth Newark Newbury Norwich Oakham Orford
      Oxford Penrith Plymouth Pontefract Reading Redbridge Richmond Ripon Rochester Romsey
      Salisbury Selby Sherborne Shrewsbury Skipton Southwell Stamford Stockton Stratford Sudbury
      Taunton Tewkesbury Thame Thetford Tiverton Tonbridge Totnes Truro Upton Warwick Wells
      Whitby Winchester Windsor Wisbech Witney Woodbridge Worcester Wroxham Wymondham York`,
    roots: ["Ash", "Bram", "Elm", "Hart", "Oak", "Raven", "Wick", "Whit"],
    endings: ["ford", "bridge", "bury", "chester", "combe", "ton", "wick", "worth"],
  },
  {
    id: "costa",
    name: "Costan",
    inspiration: "Italian and Iberian town names",
    samples: `Alba Alcala Alicante Almeria Altea Aranda Arezzo Astorga Asti Avila Aviles Baeza
      Bari Belluno Bergamo Bologna Braga Brescia Brindisi Caceres Cadiz Calahorra Caltanissetta
      Carmona Carrara Caserta Castellon Catania Coimbra Cordoba Cortona Cremona Cuenca Estepona
      Faenza Faro Ferrara Fiesole Firenze Foligno Forli Gaeta Gallipoli Girona Granada Grazalema
      Huelva Jaen Jerez Latina Lerida Livorno Logrono Lorca Lucca Lugo Malaga Mantova Matera
      Merida Messina Modena Monza Morella Murcia Napoli Nardo Nola Olbia Oristano Orvieto Osuna
      Otranto Oviedo Padova Palermo Parma Pavia Perugia Pesaro Piacenza Pisa Pistoia Portimao
      Prato Ragusa Ravenna Rieti Rimini Ronda Rovigo Salerno Salamanca Savona Segovia Siena
      Silves Siracusa Soria Spoleto Taranto Teramo Teruel Tivoli Toledo Torino Trani Trento
      Treviso Tudela Urbino Valencia Varese Verona Vicenza Viterbo Zamora Zaragoza`,
    roots: ["Alba", "Bella", "Cala", "Fonte", "Monte", "Pietra", "Riva", "Val"],
    endings: ["dora", "lina", "mora", "nova", "rosa", "terra", "verde", "vella"],
  },
  {
    id: "fjords",
    name: "Fjordic",
    inspiration: "Norwegian and Swedish coastal and inland towns",
    samples: `Alesund Alta Alvdal Arendal Askim Askoy Bergen Bodo Boras Borgholm Borlange
      Brumunddal Drammen Egersund Elverum Enkoping Eskilstuna Falkenberg Falun Farsund Flekkefjord
      Floro Fredrikstad Gallivare Geilo Gjovik Grimstad Hadeland Halden Halmstad Hamar Hammerfest
      Harstad Haugesund Hedemora Helsingborg Horten Huddinge Hudiksvall Jonkoping Kalmar Karlstad
      Kirkenes Kiruna Kongsberg Kongsvinger Kristianstad Kristiansund Kumla Larvik Leksand Lerum
      Lidkoping Lillehammer Lindesberg Lofoten Lulea Lund Lyngdal Malmo Mandal Mariestad Molde
      Mora Moss Motala Narvik Norrkoping Norrtalje Notodden Odda Orebro Ornskoldsvik Ostersund
      Pitea Rattvik Roros Sandefjord Sandnes Sandviken Sarpsborg Skara Skien Skovde Sogndal
      Soderhamn Solleftea Sortland Stavanger Steinkjer Stromstad Stryn Sundsvall Torsby Tromso
      Trondheim Tvedestrand Uddevalla Umea Uppsala Vadsund Varnamo Vastervik Voss Ystad`,
    roots: ["Arne", "Bjor", "Dal", "Eik", "Haug", "Lind", "Sand", "Stor"],
    endings: ["berg", "dal", "fjord", "hamn", "heim", "holm", "sund", "vik"],
  },
  {
    id: "wadis",
    name: "Wadic",
    inspiration: "Arabic place names in simple Latin transliteration",
    samples: `Adana Ajdabiya Amman Aqaba Arish Aswan Azraq Baalbek Basra Batna Bechar Benghazi
      Biskra Blida Bouira Busra Dahab Dakhla Damanhur Daraa Derna Djanet Dongola Douma Erbil
      Fallujah Farafra Fayoum Gabes Gafsa Ghardaia Ghat Giza Hama Homs Hurghada Irbid Ismailia
      Jableh Jerash Jizan Jubail Kairouan Karak Karbala Kassala Kebili Kenitra Kerak Kharga
      Khobar Kosti Kufa Latakia Maarrat Madaba Mafraq Mahdia Manama Marib Matmata Medina Meknes
      Minya Misrata Mosul Nablus Najaf Najran Nizwa Oujda Palmyra Qadisiyah Qalqilya Qena Quseir
      Rafah Ramadi Ramtha Raqqa Rashid Riyadh Safaga Safi Salalah Salt Samarra Sana Sefrou
      Sfax Sidon Siwa Sohag Sousse Suakin Tabarka Tabuk Tadmor Taif Tangier Taroudant Tataouine
      Taza Tetouan Tiaret Tiberias Tlemcen Tozeur Tripoli Tyre Wadani Wajh Yanbu Zarqa Zawiya`,
    roots: ["Ain", "Bir", "Dar", "Jabal", "Qasr", "Ras", "Tell", "Wadi"],
    endings: ["Hamar", "Jadid", "Kamil", "Nadir", "Rimal", "Safra", "Sahir", "Zahir"],
  },
  {
    id: "isles",
    name: "Islander",
    inspiration: "Japanese city and town names in romaji",
    samples: `Akashi Akita Amagasaki Aomori Asahikawa Atami Atsugi Beppu Chiba Chichibu Chigasaki
      Chitose Daisen Ebina Fukui Fukuoka Fukushima Fukuyama Furano Gifu Gotemba Hachinohe Hagi
      Hakodate Hakone Hamada Hamamatsu Hanamaki Hikone Himeji Hino Hirosaki Hiroshima Hitachi
      Iida Iiyama Imabari Inuyama Isahaya Ise Ishinomaki Ito Iwaki Iwakuni Izumo Kagoshima Kakegawa
      Kamaishi Kamakura Kanazawa Kanoya Karatsu Kariya Kashima Kashiwa Kasugai Kawagoe Kawasaki
      Kesennuma Kitami Kobe Kochi Kofu Koriyama Kumamoto Kurashiki Kurume Kushiro Maebashi
      Matsue Matsumoto Matsuyama Mito Miyako Miyazaki Morioka Murakami Nagahama Nagano Nagasaki
      Nagoya Naha Nanao Nara Naruto Nasushiobara Niigata Nikko Nishio Numazu Obihiro Odawara
      Okayama Okazaki Omura Onomichi Otaru Otsu Saga Sakai Sakata Sakura Sano Sapporo Sasebo
      Sendai Seto Shibata Shimada Shimizu Shimonoseki Shizuoka Takamatsu Takaoka Takasaki
      Takayama Tanabe Tateyama Tokushima Tottori Toyama Toyohashi Tsu Tsukuba Ueda Uji Uwajima
      Wakayama Yamagata Yamaguchi Yatsushiro Yokkaichi Yokohama Yonago Yonezawa Yoshida`,
    roots: ["Aka", "Hana", "Ishi", "Kami", "Kawa", "Matsu", "Mizu", "Taka"],
    endings: ["gawa", "hama", "kawa", "machi", "mori", "saki", "shima", "yama"],
  },
];

/** GIS naming vocabulary is independent of the reference game's entity taxonomy. */
export const atlasNamingKinds = {
  biome: [
    "Temperate forest",
    "Boreal forest",
    "Montane forest",
    "Conifer forest",
    "Mixed forest",
    "Rainforest",
    "Dry forest",
    "Tundra",
    "Savanna",
    "Steppe",
    "Prairie",
    "Bog",
    "Floodplain marsh",
    "Swamp",
    "Marsh",
    "Polar desert",
    "Rock barrens",
    "Hot desert",
    "Cold desert",
    "Altered woodland",
    "Altered wetland",
    "Ember grassland",
    "Thaw forest",
    "Thaw meadow",
    "Thaw ground",
  ],
  ocean: ["ocean", "sea"],
  settlement: ["city", "town", "village"],
  polity: ["state", "commonwealth"],
  culture: [],
  river: [],
  lake: [],
  landform: [
    "peak",
    "range",
    "valley",
    "cirque",
    "fjord",
    "moraine",
    "waterfall",
    "gorge",
    "crater",
    "volcano",
    "caldera",
    "fault",
  ],
  magic: [],
} satisfies Record<string, string[]>;
export type AtlasNamingKind = keyof typeof atlasNamingKinds;

function grammar(id: string, productions: string[][]): Grammar {
  return { id, start: "name", capitalization: "titleWords", rules: { name: productions } };
}
function profile(kind: AtlasNamingKind): Profile {
  return {
    id: kind,
    entityKinds: [kind],
    isDefault: false,
    strategyGroups: [
      {
        name: kind,
        priority: 0,
        conditions: null,
        strategies:
          kind === "settlement"
            ? [
                { type: "grammar", grammarId: "place", weight: 9 },
                { type: "grammar", grammarId: "compound", weight: 1 },
              ]
            : [
                {
                  type: "grammar",
                  grammarId: kind === "culture" ? "place" : "geography",
                  weight: 1,
                },
              ],
      },
    ],
  };
}
export const atlasNamingCultures: Culture[] = namingSources.map((source) => ({
  id: source.id,
  name: source.name,
  description: source.inspiration,
  domains: [],
  lexemeLists: {
    roots: { id: "roots", entries: source.roots },
    endings: { id: "endings", entries: source.endings },
  },
  grammars: [
    grammar("place", [[`markov:${source.id}`]]),
    grammar("compound", [
      [
        source.id === "wadis" ? "slot:roots" : "slot:roots^slot:endings",
        ...(source.id === "wadis" ? ["slot:endings"] : []),
      ],
    ]),
    grammar("geography", [[`markov:${source.id}`, "context:geographicTerm"]]),
  ],
  profiles: (Object.keys(atlasNamingKinds) as AtlasNamingKind[]).map(profile),
}));

export const atlasNamingModels = new Map(
  namingSources.map((source) => [
    source.id,
    trainMarkovChain(source.samples.trim().split(/\s+/), 3),
  ])
);
