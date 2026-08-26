import ultraformerMpt from "./assets/ultraformer_mpt.png";
import lavienBbLaser from "./assets/lavien_bb_laser.png";
import protocoloPosMounjaro from "./assets/protocolo_pos_mounjaro.png";
import bumbumMax from "./assets/bumbum_max.png";
import skinboosterPremium from "./assets/skinbooster_premium.png";
import limpezaDePelePremium from "./assets/limpeza_de_pele_premium.png";
import depilacaoLaserComfort from "./assets/depilacao_laser_comfort.png";
import drenagemLinfatica from "./assets/drenagem_linfatica.png";
import antes from "./assets/antes.jpg";
import depois from "./assets/depois.jpg";
import antes2 from "./assets/antes2.jpg";
import depois2 from "./assets/depois2.jpg";
import antes3 from "./assets/antes3.jpg";
import depois3 from "./assets/depois3.jpg";

export interface Treatment {
  id: string;
  name: string;
  category: "facial" | "corporal" | "tecnologia" | "spa";
  tagline: string;
  description: string;
  benefits: string[];
  duration: string;
  recovery: string;
  highlights: boolean;
  image: string; // We'll use premium Unsplash aesthetic images
}

export interface Review {
  id: string;
  author: string;
  rating: number;
  text: string;
  treatment: string;
  date: string;
}

export interface BeforeAfterItem {
  id: string;
  title: string;
  concern: string;
  procedure: string;
  result: string;
  beforeImg: string;
  afterImg: string;
}

export const TREATMENTS: Treatment[] = [
  {
    id: "ultraformer-mpt",
    name: "Ultraformer MPT",
    category: "tecnologia",
    tagline: "O ápice do lifting facial e corporal sem agulhas e sem cortes",
    description: "Tecnologia de ultrassom micro e macrofocado de última geração. O MPT (Micro Pulsed Technology) atua de forma ultrarrápida e indolor nas camadas mais profundas da pele e do músculo, promovendo ancoragem muscular, estímulo de colágeno e quebra de gordura localizada com precisão milimétrica.",
    benefits: [
      "Lifting facial imediato e contorno da mandíbula definido",
      "Estímulo intenso de colágeno (efeito poupança de colágeno)",
      "Redução drástica da papada e pálpebras caídas",
      "Tratamento de flacidez corporal (braços, abdômen e coxas)",
      "Procedimento rápido, sem agulhas e sem tempo de recuperação"
    ],
    duration: "40 a 60 minutos",
    recovery: "Imediato (retorno imediato às atividades)",
    highlights: true,
    image: ultraformerMpt
  },
  {
    id: "lavien-bb-laser",
    name: "Lavien BB Laser",
    category: "tecnologia",
    tagline: "Sua pele com efeito permanente de BB Cream e viço de porcelana",
    description: "Laser de Tulium subablativo luxuoso que simula o acabamento impecável de um BB Cream na pele. Age tratando as manchas, linhas finas, lesões pigmentadas e poros dilatados, proporcionando uma renovação global na textura da pele com tempo mínimo de recuperação.",
    benefits: [
      "Uniformização imediata do tom da pele",
      "Fechamento expressivo de poros dilatados",
      "Tratamento seguro para melasma e manchas de sol",
      "Melhora instantânea no viço, luminosidade e textura",
      "Rejuvenescimento de colo, pescoço e mãos"
    ],
    duration: "30 minutos",
    recovery: "Leve vermelhidão por 12 a 24 horas",
    highlights: true,
    image: lavienBbLaser
  },
  {
    id: "protocolo-pos-mounjaro",
    name: "Protocolo Pós-Mounjaro & Ozempic",
    category: "corporal",
    tagline: "Restauração do tônus facial e corporal pós-emagrecimento rápido",
    description: "Criado especialmente para reverter a flacidez e o aspecto 'vazio' facial (rosto de Ozempic) e corporal decorrente da perda rápida de peso. Combina tecnologias de ultrassom focado de alta potência, bioestimuladores de colágeno e volumizadores estratégicos para devolver a firmeza, o preenchimento saudável e as curvas naturais.",
    benefits: [
      "Reposição volumétrica natural de gordura de sustentação facial",
      "Combate intenso à flacidez de pele abdominal, braços e pernas",
      "Associação sinérgica de bioestimuladores (Sculptra/Radiesse) com Ultraformer MPT",
      "Melhora da densidade cutânea e visual saudável global",
      "Desenvolvido de forma individualizada com base nas metas do paciente"
    ],
    duration: "Sessões combinadas de 60 a 90 minutos",
    recovery: "Mínimo (pequenos pontos de injeção ocultáveis)",
    highlights: true,
    image: protocoloPosMounjaro
  },
  {
    id: "bumbum-max",
    name: "Bumbum Max",
    category: "corporal",
    tagline: "Harmonização glútea premium para volume, lifting e contorno perfeito",
    description: "O protocolo queridinho para redefinir o contorno glúteo de forma segura e elegante. Combina a aplicação de bioestimuladores de colágeno superpotentes com preenchedores específicos de ácido hialurônico de alta densidade celular, além de terapia firmadora para empinar, volumizar e tratar a celulite de grau avançado.",
    benefits: [
      "Projeção e empinamento imediato do bumbum",
      "Preenchimento de depressões laterais (gretas trocantéricas)",
      "Eliminação profunda de celulites e flacidez glútea",
      "Melhora incrível na textura da pele e sustentação muscular",
      "Resultados duradouros e altamente naturais"
    ],
    duration: "60 minutos",
    recovery: "Sem repouso (evitar apenas atividade física pesada em 48h)",
    highlights: true,
    image: bumbumMax
  },
  {
    id: "skinbooster",
    name: "Skinbooster Premium",
    category: "facial",
    tagline: "Hidratação injetável ultraprofunda para maciez e firmeza extraordinárias",
    description: "Procedimento minimamente invasivo que injeta microgotas de ácido hialurônico fluido sob a pele, juntamente com complexos de multivitaminas. Diferente dos preenchedores tradicionais, ele não adiciona volume grosseiro, mas atua retendo água nas camadas profundas, preenchendo rídulas e esticando as linhas finas.",
    benefits: [
      "Hidratação de dentro para fora que nenhum creme consegue alcançar",
      "Suavização das rugas finas do rosto, pescoço e colo",
      "Estímulo sutil e constante de elastina",
      "Deixa a pele com toque aveludado e brilho 'glass skin'",
      "Excelente preventivo contra o envelhecimento precoce"
    ],
    duration: "30 minutos",
    recovery: "Poucas horas (pequenas pápulas resolvidas no mesmo dia)",
    highlights: false,
    image: skinboosterPremium
  },
  {
    id: "limpeza-de-pele",
    name: "Limpeza de Pele Premium",
    category: "spa",
    tagline: "Protocolo clínico de higienização celular e desintoxicação de luxo",
    description: "Muito além de uma limpeza convencional. Nosso protocolo VIP engloba peeling ultrassônico, higienização com sabonete de ácidos nobres, vapor de ozônio medicinal, extração manual criteriosa e indolor, aplicação de alta frequência calmante e máscara de LED combinada com ativos clareadores e calmantes importados.",
    benefits: [
      "Remoção completa de cravos, milium e impurezas profundas",
      "Controle ativo da oleosidade e prevenção de acne",
      "Desbaste de células mortas trazendo luminosidade",
      "Nutrição profunda com fototerapia de LED vermelho/azul",
      "Momento de bem-estar, massagem facial relaxante inclusa"
    ],
    duration: "90 minutos",
    recovery: "Nenhum (pele sai limpa, calma e sem marcas roxas)",
    highlights: false,
    image: limpezaDePelePremium
  },
  {
    id: "depilacao-laser",
    name: "Depilação a Laser Led Comfort",
    category: "tecnologia",
    tagline: "Liberdade e pele sedosa sem dor com tecnologia alemã avançada",
    description: "Diga adeus à foliculite e ao sofrimento das ceras. Utilizamos o equipamento mais sofisticado do mercado, dotado de ponteira ultra resfriada a -5°C que anestesia o local no momento do disparo. Eficaz em pelos finos, grossos e seguro para todos os fototipos, inclusive peles negras e bronzeadas.",
    benefits: [
      "Eliminação permanente e progressiva dos pelos",
      "Ponteira de safira resfriada que garante sessão sem dor",
      "Tratamento e cura da foliculite inflamada crônica",
      "Clareamento natural das axilas e virilha devido ao fim do atrito",
      "Resultados visíveis desde a primeira sessão"
    ],
    duration: "15 a 45 minutos (conforme área)",
    recovery: "Imediato",
    highlights: false,
    image: depilacaoLaserComfort
  },
  {
    id: "drenagem-linfatica",
    name: "Drenagem Linfática Modeladora",
    category: "spa",
    tagline: "Combate à retenção de líquidos, detoxificação e contorno corporal refinado",
    description: "Massagem corporal executada por fisioterapeutas com manobras precisas, baseadas nos linfonodos principais. Ideal para diminuir o inchaço decorrente de oscilações hormonais, aliviar cansaço nas pernas, acelerar o metabolismo e essencial no pós-operatório imediato e tardio de cirurgias plásticas.",
    benefits: [
      "Redução imediata de medidas causadas por retenção hídrica",
      "Eliminação de toxinas acumuladas e melhora circulatória",
      "Aceleração da recuperação e prevenção de fibroses pós-cirúrgicas",
      "Sensação marcante de leveza e relaxamento profundo",
      "Auxilia na redução visível do aspecto casca de laranja"
    ],
    duration: "50 a 60 minutos",
    recovery: "Imediato",
    highlights: false,
    image: drenagemLinfatica
  }
];

export const REVIEWS: Review[] = [
  {
    id: "r1",
    author: "Karina Alencar",
    rating: 5,
    text: "Fiz o Ultraformer MPT com a Dra. Musa e o resultado na minha papada foi inacreditável! Parecia que eu tinha feito uma mini lipo, mas sem corte nenhum. A clínica é linda, atendimento digno de hotel 5 estrelas. Super recomendo!",
    treatment: "Ultraformer MPT",
    date: "2026-05-15"
  },
  {
    id: "r2",
    author: "Mariana Costa",
    rating: 5,
    text: "O Lavien BB Laser transformou minhas manchas de melasma de anos. Tinha tentado vários cremes e nada funcionava. Em duas sessões meu rosto está limpo, luminoso e com uma textura maravilhosa. Parece maquiagem o tempo todo!",
    treatment: "Lavien BB Laser",
    date: "2026-05-28"
  },
  {
    id: "r3",
    author: "Juliana Mendes",
    rating: 5,
    text: "Depois que emagreci rápido fiz o Protocolo Pós-Mounjaro e ajudou muito a recuperar o tônus do abdômen e do bumbum. A Dra. Musa é super atenciosa, explica tudo com calma e faz um planejamento perfeito pra nossa realidade.",
    treatment: "Protocolo Pós-Mounjaro",
    date: "2026-05-10"
  },
  {
    id: "r4",
    author: "Rafaela Vieira",
    rating: 5,
    text: "O protocolo Bumbum Max é incrível! Deu uma projeção linda e sumiu totalmente com as celulites que me incomodavam demais na praia. Vale cada centavo investido, a equipe é extremamente profissional.",
    treatment: "Bumbum Max",
    date: "2026-06-01"
  }
];

export const BEFORE_AFTERS: BeforeAfterItem[] = [
  {
    id: "ba1",
    title: "Lifting Facial e Definição de Mandíbula",
    concern: "Flacidez persistente no terço inferior, perda de definição e queixo duplo ('papada')",
    procedure: "1 sessão de Ultraformer MPT Facial + Estímulo de Ancoragem Muscular",
    result: "Mandíbula perfeitamente esculpida, redução de 80% da papada e efeito lifting natural imediato.",
    beforeImg: antes,
    afterImg: depois
  },
  {
    id: "ba2",
    title: "Uniformização e Controle de Melasma",
    concern: "Hiperpigmentação difusa na face, poros dilatados e textura sem brilho",
    procedure: "2 sessões de Lavien BB Laser + Protocolo Antioxidante Homecare",
    result: "Pele com tom homogêneo, clareamento substancial do melasma e brilho 'efeito porcelana'.",
    beforeImg: antes2,
    afterImg: depois2
  },
  {
    id: "ba3",
    title: "Arquitetura Glútea e Correção de Depressão",
    concern: "Depressão trocantérica (lateral do bumbum), flacidez cutânea e falta de projeção",
    procedure: "Protocolo Bumbum Max (Bioestimulador + Preenchimento Híbrido Estético)",
    result: "Formato arredondado e empinado, preenchimento das depressões e pele lisa sem celulite.",
    beforeImg: antes3,
    afterImg: depois3
  }
];

export const FAQS = [
  {
    q: "Como sei qual é o tratamento ideal para o meu caso?",
    a: "Na Dra. Musa Estética de Elite, toda jornada começa com uma Avaliação Integrativa detalhada feita pessoalmente por Dra. Musa Valentina. Analisamos seu histórico, grau de flacidez, qualidade de pele e seus objetivos de forma personalizada, recomendando soluções sob medida."
  },
  {
    q: "O Ultraformer MPT dói? Quanto tempo demora pra fazer?",
    a: "Diferente das tecnologias antigas de ultrassom focado, o MPT possui a tecnologia Micro Pulsada que entrega a energia de forma contínua e muito mais veloz, tornando o procedimento praticamente indolor (apenas uma leve sensação de aquecimento profundo). As sessões duram entre 30 e 50 minutos."
  },
  {
    q: "O que é o Lavien BB Laser e por que ele é tão famoso?",
    a: "Ele é conhecido como o laser queridinho das famosas porque simula o efeito de um BB Cream impecável sobre a pele. Ele renova as células superficiais, reduz poros dilatados, clareia manchas e melasma, deixando a pele com viço radiante quase que imediatamente, sem precisar afastar você dos compromissos."
  },
  {
    q: "Em quanto tempo vejo os resultados do Bumbum Max?",
    a: "Uma parte do resultado é visível imediatamente após o procedimento (devido ao preenchimento de ácido hialurônico que traz projeção e volume). A outra parte se desenvolve progressivamente ao longo de 30 a 90 dias, conforme os bioestimuladores de colágeno agem tornando a pele glútea extremamente firme e lisa."
  },
  {
    q: "Qual o endereço da clínica e qual o horário de funcionamento?",
    a: "Nossa clínica de alto padrão está localizada na Av. das Musas, 900 — Jardim Paulista — São Paulo/SP — CEP 01400-000. Nosso horário de funcionamento é de segunda à sexta das 9hrs às 11hrs / 14hrs às 20hrs, e aos sábados das 8hrs às 13hrs."
  }
];

export interface Lead {
  id: string;
  name: string;
  whatsapp: string; // Used by public site form (phone)
  treatment: string; // Used by public site form (interest)
  message: string;
  scoreResult?: string;
  date: string; // createdAt
  status: "novo" | "contatado" | "agendado" | "arquivado" | "new" | "contacted" | "proposal_sent" | "converted";
  phone?: string;
  interest?: string;
  source?: string;
  createdAt?: string;
}
